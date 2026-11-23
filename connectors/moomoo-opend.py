"""Private bridge for one local Qot_GetSecuritySnapshot using moomoo-api 10.12.7208."""
import contextlib
import json
import re
import sys
from importlib.metadata import version


def snapshot(port, symbol):
    from google.protobuf.json_format import MessageToDict
    from moomoo import OpenQuoteContext, RET_OK
    from moomoo.quote.quote_query import MarketSnapshotQuery

    # Keep the official response, including the optional UTC epoch that the
    # SDK's pandas projection drops. The SDK owns connection setup and framing.
    def unpack(message):
        return RET_OK, "", MessageToDict(message, preserving_proto_field_name=True)

    ctx = OpenQuoteContext(host="127.0.0.1", port=port)
    try:
        query = ctx._get_sync_query_processor(MarketSnapshotQuery.pack_req, unpack)
        status, _, response = query(stock_list=[symbol], conn_id=ctx.get_sync_conn_id())
        if status != RET_OK:
            raise RuntimeError("OPEND_SNAPSHOT_FAILED")
        return response
    finally:
        ctx.close()


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[3] != "--entitled-zero-cost":
        raise SystemExit("ENTITLED_ZERO_COST_READ_REQUIRED")
    if version("moomoo-api") != "10.12.7208":
        raise SystemExit("UNQUALIFIED_SDK_VERSION")
    port = int(sys.argv[1])
    symbol = sys.argv[2]
    if not 1 <= port <= 65535 or not re.fullmatch(r"(US|HK)\.[A-Z0-9][A-Z0-9.-]{0,19}", symbol):
        raise SystemExit("INVALID_SNAPSHOT_REQUEST")
    with contextlib.redirect_stdout(sys.stderr):
        result = snapshot(port, symbol)
    print(json.dumps(result, allow_nan=False))
