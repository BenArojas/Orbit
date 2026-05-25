// src/components/options/OptionsChainHeader.tsx

import React from "react";
import { Grid, Typography, SxProps, Theme } from "@mui/material";

const headerCellStyle: SxProps<Theme> = { color: "grey.500", fontSize: "0.75rem" };
const callHeaderOrder = ["Delta", "Bid Size", "Ask Size", "Last", "Ask", "Bid"];
const putHeaderOrder = ["Bid", "Ask", "Last", "Ask Size", "Bid Size", "Delta"];

const HeaderColumn = ({ headers, alignment }: { headers: string[], alignment: 'left' | 'right' }) => (
  <Grid container spacing={2} justifyContent={alignment === 'left' ? 'flex-start' : 'flex-end'}>
    {headers.map((h) => (
      <Grid item key={h} xs sx={{ textAlign: alignment, minWidth: "50px" }}>
        <Typography sx={headerCellStyle}>{h}</Typography>
      </Grid>
    ))}
  </Grid>
);

export const OptionsChainHeader: React.FC = () => (
  <Grid container alignItems="center" justifyContent="center" sx={{ py: 1, borderBottom: "2px solid #555" }}>
    <Grid item xs={5}>
      <HeaderColumn headers={callHeaderOrder} alignment="left" />
    </Grid>
    <Grid item xs={2} textAlign="center">
      <Typography sx={headerCellStyle}>Strike</Typography>
    </Grid>
    <Grid item xs={5}>
      <HeaderColumn headers={putHeaderOrder} alignment="right" />
    </Grid>
  </Grid>
);