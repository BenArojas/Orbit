import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { fmt, useRecentTrades } from "./Transactions";
import { CardDescription, CardTitle } from "@/components/ui/card";

export const SummaryCards: React.FC<{
  s: ReturnType<typeof useRecentTrades>["summary"];
}> = ({ s }) => {
  const cashColor = s.netCash >= 0 ? "text-green-500" : "text-red-500";
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader>
          <CardTitle>Net&nbsp;Cash&nbsp;Flow</CardTitle>
          {/* <TrendingUp className="absolute right-6 top-6 h-4 w-4 text-gray-400" /> / */}
        </CardHeader>
        <CardContent>
          <CardDescription className={cashColor}>
            {fmt(s.netCash)}
          </CardDescription>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Total Volume Traded</CardTitle>
          {/* <DollarSign className="absolute right-6 top-6 h-4 w-4 text-gray-400" /> */}
        </CardHeader>
        <CardContent>
          <CardDescription>{fmt(s.totalVolume)}</CardDescription>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Total Trades</CardTitle>
          {/* <ArrowLeftRight className="absolute right-6 top-6 h-4 w-4 text-gray-400" /> */}
        </CardHeader>
        <CardContent>
          <CardDescription>{s.totalTrades}</CardDescription>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Total Commissions</CardTitle>
          {/* <ReceiptText className="absolute right-6 top-6 h-4 w-4 text-gray-400" /> */}
        </CardHeader>
        <CardContent>
          <CardDescription>{fmt(s.totalCommissions)}</CardDescription>
        </CardContent>
      </Card>
    </div>
  );
};
