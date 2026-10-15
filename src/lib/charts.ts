// Register only the chart types and components used by this dashboard.
import { init, use } from "echarts/core";
import { GraphChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { LabelLayout } from "echarts/features";

use([GraphChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer, LabelLayout]);
export { init };
