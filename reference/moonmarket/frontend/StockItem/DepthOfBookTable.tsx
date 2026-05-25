// src/components/DepthOfBookTable.tsx

import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Typography, Box, Collapse, IconButton } from '@mui/material';
import React, { useState } from 'react';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { PriceLadderRow } from '@/types/stock';

interface DepthOfBookTableProps {
    depth: PriceLadderRow[];
}

const DepthOfBookTable: React.FC<DepthOfBookTableProps> = ({ depth }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <Paper variant="outlined">
            <Box
                onClick={() => setIsExpanded(!isExpanded)}
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    p: 2,
                    cursor: 'pointer',
                    borderBottom: isExpanded ? '1px solid' : 'none',
                    borderColor: 'divider',
                }}
            >
                <Typography variant="h6">Market Depth</Typography>
                <IconButton size="small">
                    {isExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                </IconButton>
            </Box>

            <Collapse in={isExpanded}>
                {/* ✅ FIX: Add a Box with a fixed height and flex properties */}
                <Box sx={{ height: 180, display: 'flex', flexDirection: 'column' }}>
                    {/* ✅ FIX: Remove maxHeight from here and let it fill the Box */}
                    <TableContainer sx={{ overflowY: 'auto' }}>
                        <Table stickyHeader size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>Bid Size</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>Price</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>Ask Size</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {depth.length > 0 ? (
                                    depth.map((row, index) => (
                                        <TableRow key={index} sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                            <TableCell align="center">{row.bidSize}</TableCell>
                                            <TableCell align="center" sx={{ fontWeight: 'medium' }}>
                                                {row.price.toFixed(2)}
                                            </TableCell>
                                            <TableCell align="center">{row.askSize}</TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                                            No depth data available.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            </Collapse>
        </Paper>
    );
};

export default DepthOfBookTable;