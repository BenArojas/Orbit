import { useStockStore } from "@/stores/stockStore";
import { Box, Paper, Typography, Grid, Tabs, Tab, Chip } from '@mui/material';
import React, { useState } from 'react';

// --- Helper Components & Functions ---

const formatCurrency = (value?: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ p: 2 }}>{children}</Box>}
    </div>
  );
}

// --- Main Component ---

export const PositionDetails: React.FC = () => {
    const stockPosition = useStockStore((state) => state.activeStock.position);
    const optionsPositions = useStockStore((state) => state.activeStock.optionPositions);
    const [tabIndex, setTabIndex] = useState(0);

    const hasStockPosition = !!stockPosition;
    const hasOptionsPositions = optionsPositions && optionsPositions.length > 0;

    // Adjust the initial tab if the stock position doesn't exist but options do
    React.useEffect(() => {
        if (!hasStockPosition && hasOptionsPositions) {
            setTabIndex(1);
        } else {
            setTabIndex(0);
        }
    }, [hasStockPosition, hasOptionsPositions]);


    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue);
    };

    if (!hasStockPosition && !hasOptionsPositions) {
        return (
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                    You do not hold any positions in this instrument or its derivatives.
                </Typography>
            </Paper>
        );
    }

    return (
        <Paper variant="outlined">
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs value={tabIndex} onChange={handleTabChange} variant="fullWidth">
                    <Tab label="Stock Position" disabled={!hasStockPosition} />
                    <Tab label="Options Positions" disabled={!hasOptionsPositions} />
                </Tabs>
            </Box>

            {/* --- Stock Position Panel --- */}
            <TabPanel value={tabIndex} index={0}>
                {hasStockPosition && (
                    <Grid container spacing={2}>
                        <Grid item xs={6} sm={3}>
                            <Typography variant="body2" color="text.secondary">Quantity:</Typography>
                            <Typography variant="body1" component="p">{stockPosition.position.toLocaleString()}</Typography>
                        </Grid>
                        <Grid item xs={6} sm={3}>
                            <Typography variant="body2" color="text.secondary">Avg. Cost:</Typography>
                            <Typography variant="body1" component="p">{formatCurrency(stockPosition.avgCost)}</Typography>
                        </Grid>
                        <Grid item xs={6} sm={3}>
                            <Typography variant="body2" color="text.secondary">Market Value:</Typography>
                            <Typography variant="body1" component="p">{formatCurrency(stockPosition.mktValue)}</Typography>
                        </Grid>
                        <Grid item xs={6} sm={3}>
                            <Typography variant="body2" color="text.secondary">Unrealized P/L:</Typography>
                            <Typography component="p" color={stockPosition.unrealizedPnl >= 0 ? 'success.main' : 'error.main'}>
                                {formatCurrency(stockPosition.unrealizedPnl)}
                            </Typography>
                        </Grid>
                    </Grid>
                )}
            </TabPanel>

            {/* --- Options Positions Panel --- */}
            <TabPanel value={tabIndex} index={1}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {optionsPositions?.map((pos) => (
                        <Paper key={pos.name} variant="outlined" sx={{ p: 2 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
                                <Typography variant="body1" fontWeight="bold">{pos.name}</Typography>
                                {pos.daysToExpire !== null && (
                                    <Chip label={`${pos.daysToExpire} days to expire`} size="small" />
                                )}
                            </Box>
                            <Grid container spacing={2}>
                                <Grid item xs={6} sm={3}>
                                    <Typography variant="body2" color="text.secondary">Quantity:</Typography>
                                    <Typography>{pos.position.toLocaleString()}</Typography>
                                </Grid>
                                <Grid item xs={6} sm={3}>
                                    <Typography variant="body2" color="text.secondary">Avg. Cost:</Typography>
                                    <Typography>{formatCurrency(pos.avgCost)}</Typography>
                                </Grid>
                                <Grid item xs={6} sm={3}>
                                    <Typography variant="body2" color="text.secondary">Market Value:</Typography>
                                    <Typography>{formatCurrency(pos.mktValue)}</Typography>
                                </Grid>
                                <Grid item xs={6} sm={3}>
                                    <Typography variant="body2" color="text.secondary">Unrealized P/L:</Typography>
                                    <Typography color={pos.unrealizedPnl >= 0 ? 'success.main' : 'error.main'}>
                                        {formatCurrency(pos.unrealizedPnl)}
                                    </Typography>
                                </Grid>
                            </Grid>
                        </Paper>
                    ))}
                </Box>
            </TabPanel>
        </Paper>
    );
};