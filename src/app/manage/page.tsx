import { redirect } from "next/navigation";

// Data collection/configuration stays in the backend; the user-facing page is retired.
export default function Page() {
  redirect("/runs");
}
