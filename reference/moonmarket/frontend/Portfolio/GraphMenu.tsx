// src/components/GraphMenu.tsx
import SearchBar from "@/components/SearchBar.tsx";
import AutoAwesomeMosaicIcon from "@mui/icons-material/AutoAwesomeMosaic";
import BlurCircularIcon from "@mui/icons-material/BlurCircular";
import DonutLargeIcon from "@mui/icons-material/DonutLarge";
import SchemaIcon from "@mui/icons-material/Schema";
import TocSharpIcon from "@mui/icons-material/TocSharp";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import { Box, Button, ListItemButton, ListItemIcon } from "@mui/material";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";

export type GraphType =
  | "Treemap"
  | "DonutChart"
  | "Circular"
  | "Leaderboards"
  | "Sankey";

interface GraphMenuProps {
  selectedGraph: GraphType;
  setSelectedGraph: (graph: GraphType) => void;
  isMobileScreen: boolean;
  isDailyView: boolean;
  setIsDailyView: (isDaily: boolean) => void;
}

function GraphMenu({
  selectedGraph,
  setSelectedGraph,
  isMobileScreen,
  isDailyView,
  setIsDailyView,
}: GraphMenuProps) {
  const handleListItemClick = (graph: GraphType) => {
    if (graph !== "Treemap" && isDailyView) {
      setIsDailyView(false);
    }
    setSelectedGraph(graph);
  };

  return (
    <Box
      className="Nav-views"
      sx={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        width: "100%",
        mb: 1
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Button
          variant={isDailyView ? "contained" : "outlined"}
          startIcon={<TrendingUpIcon />}
          onClick={() => setIsDailyView(!isDailyView)}
          size="small"
          color="primary"
          disabled={selectedGraph !== "Treemap"}
          sx={{
            minWidth: isMobileScreen ? "60px" : "100px",
            height: "40px",
            borderRadius: "8px",
            opacity: selectedGraph !== "Treemap" ? 0.6 : 1,
          }}
        >
          Daily
        </Button>
        <nav aria-label="main mailbox folders">
          <List sx={{ display: "flex", flexDirection: "row", gap: 1 }}>
            {/* Treemap - Always available */}
            <ListItem disablePadding>
              <ListItemButton
                selected={selectedGraph === "Treemap"}
                onClick={() => handleListItemClick("Treemap")}
              >
                <ListItemIcon sx={{ justifyContent: "center" }}>
                  <AutoAwesomeMosaicIcon />
                </ListItemIcon>
              </ListItemButton>
            </ListItem>

            {/* DonutChart - Premium only */}
            <ListItem disablePadding>
              <ListItemButton
                selected={selectedGraph === "DonutChart"}
                onClick={() => handleListItemClick("DonutChart")}
              >
                <ListItemIcon sx={{ justifyContent: "center" }}>
                  <DonutLargeIcon />
                </ListItemIcon>
              </ListItemButton>
            </ListItem>

            {/* Other graph options - Premium only, hidden on mobile */}
            {!isMobileScreen && (
              <>
                <ListItem disablePadding>
                  <ListItemButton
                    selected={selectedGraph === "Circular"}
                    onClick={() => handleListItemClick("Circular")}
                  >
                    <ListItemIcon sx={{ justifyContent: "center" }}>
                      <BlurCircularIcon />
                    </ListItemIcon>
                  </ListItemButton>
                </ListItem>

                <ListItem disablePadding>
                  <ListItemButton
                    selected={selectedGraph === "Leaderboards"}
                    onClick={() => handleListItemClick("Leaderboards")}
                  >
                    <ListItemIcon sx={{ justifyContent: "center" }}>
                      <TocSharpIcon />
                    </ListItemIcon>
                  </ListItemButton>
                </ListItem>

                <ListItem disablePadding>
                  <ListItemButton
                    selected={selectedGraph === "Sankey"}
                    onClick={() => handleListItemClick("Sankey")}
                  >
                    <ListItemIcon sx={{ justifyContent: "center" }}>
                      <SchemaIcon />
                    </ListItemIcon>
                  </ListItemButton>
                </ListItem>
              </>
            )}
          </List>
        </nav>
      </Box>
    </Box>
  );
}

export default GraphMenu;
