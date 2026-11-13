"""Explicit read-only paper evidence. Close Orbit first: this uses client ID 1."""

import argparse
import asyncio
import json
import logging
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from exceptions import ParallaxError as IBKRError
from services.db import DatabaseService
from services.tws_broker_adapter import TwsBrokerAdapter, TwsPlaceOrderGuardError
from services.tws_data import TwsDataService


def established_api_clients(port: int) -> list[str]:
    """Pre-connect check: is another API client already holding the Gateway?

    A second client with the same client ID is rejected by the Gateway and a
    dropped half-session can hold it until restart, so fail fast with guidance
    instead of hanging on a connect timeout. Best-effort: skip silently when
    lsof is unavailable.
    """
    try:
        result = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:ESTABLISHED"],
            capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [line.strip() for line in result.stdout.splitlines() if "ESTABLISHED" in line]


async def verify(port: int) -> dict:
    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "read_only": True, "port": port, "checks": {},
        "notes": [
            "No place/modify/cancel methods are called.",
            "No account IDs, holdings, execution details, or credentials are included.",
            "Day-trade counting was retired by FINRA effective 2026-06-04 (Rule 4210, "
            "Notice 26-10); the account response carries the rule status, not a count.",
            "ATH is verified only when the history window reaches IBKR's earliest "
            "available data (reqHeadTimeStamp); otherwise it is partial or unknown.",
        ],
    }

    adapter = TwsBrokerAdapter()
    with tempfile.TemporaryDirectory(prefix="orbit-paper-evidence-") as temporary:
        db = DatabaseService(str(Path(temporary) / "evidence.db"))
        await db.initialize()
        adapter.attach_storage(db)
        try:
            await adapter.connect("127.0.0.1", port, 1)
            if not adapter.is_connected():
                # Client-ID conflicts arrive as an error callback plus a dropped
                # connection, not an exception — verify the session explicitly.
                report["checks"]["gateway_connection"] = {
                    "status": "fail", "error": "connect_failed",
                    "guidance": (
                        "No API session on client ID 1. Close Orbit and any other "
                        "API clients (they share client ID 1), restart the Gateway if "
                        "a dropped session is stuck, and confirm the API socket port "
                        "is enabled (Gateway → Configure → Settings → API)."
                    ),
                }
                return report
            report["checks"]["gateway_connection"] = {"status": "pass", "client_id": 1}
            identity = adapter.paper_identity_evidence()

            try:
                adapter.assert_paper_identity()
            except TwsPlaceOrderGuardError as exc:
                report["checks"]["paper_identity"] = {
                    "status": "fail", "error": exc.error_code, **identity,
                }
                return report
            report["checks"]["paper_identity"] = {"status": "pass", **identity}
            data = TwsDataService(adapter, db)
            account = await adapter.data_account()
            rule = account["day_trade_rule"]
            report["checks"]["day_trade_rule"] = {
                "status": rule["status"],
                "reference": rule["reference"],
                "legacy_field_observed": rule["legacy_day_trades_remaining"] is not None,
            }

            for symbol in ("SPY", "QQQ", "NVDA", "IREN"):
                try:
                    conid = await data.get_conid(symbol, sec_type="STK")
                    metadata = await data.contract_info(conid)
                    quote = await adapter.get_quote(conid, contract_info=metadata)
                    report["checks"][f"{symbol}_quote"] = {
                        "market_data_type": quote.market_data_type, "freshness": quote.freshness,
                        "entry_data_eligible": quote.entry_data_eligible,
                    }
                    report["checks"][f"{symbol}_sector"] = {
                        "status": metadata["sector_mapping_status"], "etf": metadata["sector_etf"],
                    }
                    for period, bar in (("1y", "1d"), ("10y", "1d"), ("15y", "1w")):
                        try:
                            history = await data.history(conid, period, bar)
                            report["checks"][f"{symbol}_{period}_{bar}"] = history["coverage"]
                        except (IBKRError, OSError, RuntimeError, TimeoutError) as exc:
                            report["checks"][f"{symbol}_{period}_{bar}"] = {"status": "unavailable", "error_type": type(exc).__name__}
                    if symbol == "NVDA":
                        chains = await adapter.option_parameters(conid)
                        suitable = [c for c in chains if c["expirations"] and c["strikes"]]
                        reference = quote.last if quote.last is not None else quote.close
                        if suitable and reference is not None:
                            chain = suitable[0]
                            target = (datetime.now(timezone.utc).date().toordinal() + 30)
                            expiry = min(chain["expirations"], key=lambda e: abs(
                                datetime.strptime(e[:8], "%Y%m%d").date().toordinal() - target))
                            contracts = []
                            # Not every listed strike exists for every expiry.
                            for strike in sorted(chain["strikes"], key=lambda s: abs(s - reference))[:6]:
                                try:
                                    contracts = await adapter.option_contracts(conid, expiry, strike, "C")
                                except (IBKRError, OSError, RuntimeError, TimeoutError):
                                    contracts = []
                                if contracts:
                                    break
                            option_quote = await adapter.get_quote(contracts[0]["conid"], contract_info=contracts[0]) if contracts else None
                            greeks = option_quote.greeks if option_quote else None
                            report["checks"]["option_greeks"] = {
                                "status": "observed" if greeks and all(v is not None for v in greeks.values()) else "unavailable",
                                "market_data_type": option_quote.market_data_type if option_quote else "unknown",
                            }
                        else:
                            report["checks"]["option_greeks"] = {"status": "unavailable"}
                except (IBKRError, OSError, RuntimeError, TimeoutError) as exc:
                    report["checks"][symbol] = {"status": "unavailable", "error_type": type(exc).__name__}
            positions = adapter.get_reconciliation().positions
            await adapter.flush_storage()
            executions = await db.broker_executions()
            report["checks"]["positions"] = {
                "count": len(positions),
                "option_metadata_complete": all(
                    p.multiplier and p.expiry and p.right and p.strike is not None
                    for p in positions if p.sec_type == "OPT"
                ),
                "option_positions_observed": sum(p.sec_type == "OPT" for p in positions),
                "freshness": "unknown",
            }
            report["checks"]["executions"] = {
                "observed_count": len(executions),
                "commissions_observed": sum(e["commission"] is not None for e in executions),
                "historical_coverage": "reqExecutions only; not a full trade-history import",
            }
        finally:
            await adapter.disconnect()
            await adapter.flush_storage()
            await db.close()
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", choices=(4002, 7497), type=int, default=4002)
    parser.add_argument("--confirm-orbit-closed", action="store_true", required=True,
                        help="Required: avoid a second connection using Orbit client ID 1")
    args = parser.parse_args()
    clients = established_api_clients(args.port)
    if clients:
        print(json.dumps({
            "error": "api_client_already_connected",
            "guidance": (
                "Another API client holds the Gateway connection. Close Orbit and "
                "any other API clients, then rerun. If none are running, restart "
                "the Gateway to clear a stuck session."
            ),
            "established": clients,
        }, indent=2))
        raise SystemExit(2)
    logging.basicConfig(level=logging.ERROR)
    report = asyncio.run(verify(args.port))

    print(json.dumps(report, indent=2))
    if report["checks"].get("paper_identity", {}).get("status") != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
