"""Copy exact observed Codex metadata into a local JSON draft, never mutate jobs.

No credentials, provider calls, prompt export, business execution or scheduling.
The caller still reviews/commits/deploys the generated configuration normally.
"""
from pathlib import Path
import argparse,datetime,hashlib,json,os,sys
try:
 import tomllib
except ModuleNotFoundError:
 print('This metadata reader requires Python 3.11 or later.',file=sys.stderr);sys.exit(1)

IDS=['automation','automation-2','flatkey-5','seo','seo-09-30-2','seo-16-00-ga4-search-console','seo-18-00']
RETIRED=['seo-09-00-github-traffic','seo-09-10-flatkey','seo-10-00','seo-10-00-2','seo-14-00','seo-16-25','seo-17-30','seo-2']
WORKDAYS_ONLY={'flatkey-5'}
FIELDS=['id','name','kind','status','rrule','model','reasoning_effort','updated_at','target','cwds']
sha=lambda data:hashlib.sha256(data).hexdigest()

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--automations-dir',type=Path,default=Path.home()/'.codex/automations')
 parser.add_argument('--output',type=Path,required=True)
 parser.add_argument('--proof-output',type=Path)
 mode=parser.add_mutually_exclusive_group(required=True)
 mode.add_argument('--expect-restored',action='store_true')
 mode.add_argument('--expect-paused',action='store_true')
 args=parser.parse_args()
 def safe_output(file):
  return file.suffix=='.json' and not file.is_symlink() and not file.resolve().is_relative_to(args.automations_dir.resolve())
 if not safe_output(args.output):raise ValueError('unsafe_metadata_output')
 if args.proof_output and (not safe_output(args.proof_output) or args.proof_output.resolve()==args.output.resolve()):raise ValueError('unsafe_proof_output')
 for aid in RETIRED:
  if (args.automations_dir/aid/'automation.toml').exists():raise ValueError('retired_entry_still_present:'+aid)
 tasks=[];observed=[]
 for aid in IDS:
  file=args.automations_dir/aid/'automation.toml'
  if not file.is_file() or file.is_symlink() or file.stat().st_size>2*1024*1024:raise ValueError('invalid_metadata_file:'+aid)
  raw=file.read_bytes();item=tomllib.loads(raw.decode())
  expected={'PAUSED'} if args.expect_paused else {'ACTIVE','PAUSED'} if aid=='automation-2' else {'ACTIVE'}
  if item.get('id')!=aid or item.get('kind')!='cron' or item.get('status') not in expected:raise ValueError('actual_status_or_identity_not_confirmed:'+aid)
  if not all(key in item for key in FIELDS):raise ValueError('original_metadata_field_missing:'+aid)
  task={key:item[key] for key in FIELDS}
  task['workdaysOnly']=aid in WORKDAYS_ONLY
  tasks.append(task);observed.append({'id':aid,'sourceFile':str(file),'sourceSha256':sha(raw),'status':item['status']})
 at=datetime.datetime.now(datetime.timezone.utc).isoformat()
 output={'verifiedAt':at,'timezone':'Asia/Shanghai','tasks':tasks,'verificationScope':IDS}
 text=json.dumps(output,ensure_ascii=False,indent=2)+'\n'
 args.output.parent.mkdir(parents=True,exist_ok=True)
 temporary=args.output.parent/('.'+args.output.name+'.'+str(os.getpid()))
 try:
  with temporary.open('x') as handle:handle.write(text)
  os.replace(temporary,args.output)
 finally:
  if temporary.exists():temporary.unlink()
 proof={'status':'OBSERVED_LOCAL_METADATA_SNAPSHOT_ONLY','observedAt':at,'expectedMode':'active' if args.expect_restored else 'paused','entries':observed,'output':str(args.output),'outputSha256':sha(text.encode()),'retiredIdsAbsent':RETIRED,'privatePromptsExported':False,'automationMutations':0,'networkRequests':0,'businessRuns':0}
 if args.proof_output:
  args.proof_output.parent.mkdir(parents=True,exist_ok=True);args.proof_output.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({key:proof[key] for key in ['status','expectedMode','output','outputSha256','privatePromptsExported','automationMutations','networkRequests']}))

if __name__=='__main__':
 try:main()
 except (OSError,ValueError,KeyError) as error:
  print(json.dumps({'status':'METADATA_NOT_SYNCED','reason':str(error),'automationMutations':0}),file=sys.stderr);sys.exit(1)
