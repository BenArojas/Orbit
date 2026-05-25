import DonutSkeleton from "@/Skeletons/DonutSkeleton";
import TreeMapSkeleton from "@/Skeletons/TreeMapSkeleton";
import { DonutChart } from "@/components/charts/DonutChart";
import { Treemap } from "@/components/charts/Treemap";
import Leaderboards from "@/components/leaderboards/Leaderboards";
import Sankey from "@/components/charts/SankeyChart";
import { CircularPacking } from "@/components/charts/CircularPackingChart";

// Define possible graph types
type GraphType = "DonutChart" | "Treemap" | "Circular" | "TableGraph" | "Leaderboards" | "Sankey";

// Define skeleton component type
type SkeletonComponent = React.ComponentType;

// Define graph component type with props
interface GraphComponentProps {
  data: any; // TODO: Replace with specific data type based on graph requirements
  width: number;
  height: number;
  isDailyView: boolean;
}
type GraphComponent = React.ComponentType<GraphComponentProps>;

// Define skeleton mapping
const skeletons: Record<GraphType, SkeletonComponent> = {
  DonutChart: DonutSkeleton,
  Treemap: TreeMapSkeleton,
  Circular: TreeMapSkeleton,
  TableGraph: TreeMapSkeleton,
  Leaderboards: TreeMapSkeleton,
  Sankey: TreeMapSkeleton,
};

// Define component mapping
const components: Partial<Record<GraphType, GraphComponent>> = {
  DonutChart: DonutChart,
  Treemap: Treemap,
  Circular: CircularPacking,
  Leaderboards: Leaderboards,
  Sankey: Sankey,
};

interface DataGraphProps {
  isDataProcessed: boolean;
  selectedGraph: GraphType;
  visualizationData: any; // TODO: Replace with specific data type based on graph requirements
  width: number;
  height: number;
  isDailyView: boolean;
}

function DataGraph({
  isDataProcessed,
  selectedGraph,
  visualizationData,
  width,
  height,
  isDailyView,
}: DataGraphProps) {
  const Skeleton: SkeletonComponent = skeletons[selectedGraph] || TreeMapSkeleton;
  const GraphComponent: GraphComponent | undefined = components[selectedGraph];

  if (!isDataProcessed) {
    return <Skeleton />;
  }

  if (!visualizationData || visualizationData.length === 0) {
    return <Skeleton />;
  }

  return GraphComponent ? (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <GraphComponent
        data={visualizationData}
        width={width}
        height={height}
        isDailyView={isDailyView}
      />
    </div>
  ) : null;
}

export default DataGraph;