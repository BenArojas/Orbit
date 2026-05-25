import React from 'react';
import { Box, Paper, Typography, Grid } from '@mui/material';
import { QuoteInfo } from '@/types/stock';

// A small, reusable card for displaying a single statistic.
const StatCard: React.FC<{ label: string; value?: string | number; color?: string }> = ({ label, value, color }) => (
  <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
    <Typography variant="caption" color="text.secondary" display="block">
      {label}
    </Typography>
    <Typography variant="h6" component="p" color={color || 'text.primary'}>
      {value ?? '---'}
    </Typography>
  </Paper>
);

interface LiveQuoteDisplayProps {
  quote: QuoteInfo;
}

const LiveQuoteDisplay: React.FC<LiveQuoteDisplayProps> = ({ quote }) => {
  const formatCurrency = (value?: number) => {
    if (typeof value !== 'number') return '---';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  const change = quote.changeAmount ?? 0;
  const changeColor = change > 0 ? 'success.main' : change < 0 ? 'error.main' : 'text.primary';
  const changePercent = `(${(quote.changePercent ?? 0).toFixed(2)}%)`;

  return (
    <Box sx={{ mb: 3 }}>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={4}>
          <StatCard
            label="Last Price"
            value={formatCurrency(quote.lastPrice)}
            color={changeColor}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
           <StatCard
            label="Day's Change"
            value={`${formatCurrency(quote.changeAmount)} ${changePercent}`}
            color={changeColor}
          />
        </Grid>
        <Grid item xs={6} sm={2}>
          <StatCard label="Bid" value={formatCurrency(quote.bid)} />
        </Grid>
        <Grid item xs={6} sm={2}>
          <StatCard label="Ask" value={formatCurrency(quote.ask)} />
        </Grid>
      </Grid>
    </Box>
  );
};

export default LiveQuoteDisplay;