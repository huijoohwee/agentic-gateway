// The published proto2 ReportMsg schema. Keep the browser decoder local to this connector.
const order = {
  1: ['order_id', 'string'], 2: ['side', 'uint32'], 3: ['coin', 'string'], 4: ['currency', 'string'],
  5: ['price', 'string'], 6: ['order_qty', 'string'], 7: ['ord_type', 'uint32'], 8: ['time_in_force', 'uint32'],
  11: ['create_time', 'int64'], 12: ['is_close', 'bool'], 13: ['cum_qty', 'string'], 14: ['avg_px', 'string'],
};
const acknowledgement = { 1: ['result', 'int32'], 2: ['err_msg', 'string'], 3: ['order_id', 'string'] };
const fill = {
  1: ['order_id', 'string'], 2: ['fill_id', 'string'], 3: ['last_px', 'string'], 4: ['last_qty', 'string'],
  5: ['leave_qty', 'string'], 6: ['fill_status', 'uint32'], 9: ['last_amount', 'string'], 10: ['biz_flow_id', 'string'],
};
const report = {
  1: ['report_id', 'string'], 4: ['order', order], 6: ['report_type', 'uint32'],
  7: ['new_rpt', acknowledgement], 9: ['cancel_rpt', acknowledgement],
  10: ['fill_rpt', fill], 11: ['expire_rpt', { 1: ['order_id', 'string'] }],
};
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function check(condition) {
  if (!condition) throw Object.assign(new Error('INVALID_PROTOBUF'), { code: 'INVALID_PROTOBUF' });
}

class Reader {
  constructor(bytes) { this.bytes = bytes; this.index = 0; }

  take(length) {
    check(length >= 0 && length <= this.bytes.length - this.index);
    const start = this.index;
    this.index += length;
    return this.bytes.subarray(start, this.index);
  }

  varint() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      check(this.index < this.bytes.length);
      const byte = this.bytes[this.index++];
      check(i < 9 || byte <= 1);
      value |= BigInt(byte & 127) << BigInt(7 * i);
      if (byte < 128) return value;
    }
    check(false);
  }

  tag() {
    const tag = this.varint();
    check(tag >= 8n && tag <= 0xffffffffn);
    return { number: Number(tag >> 3n), wire: Number(tag & 7n) };
  }

  skip(number, wire, depth = 0) {
    if (wire === 0) { this.varint(); return; }
    if (wire === 1 || wire === 5) { this.take(wire === 1 ? 8 : 4); return; }
    if (wire === 2) { this.take(Number(this.varint())); return; }
    check(wire === 3 && depth < 24);
    while (this.index < this.bytes.length) {
      const tag = this.tag();
      if (tag.wire === 4) { check(tag.number === number); return; }
      this.skip(tag.number, tag.wire, depth + 1);
    }
    check(false);
  }

  message(schema, target = {}) {
    while (this.index < this.bytes.length) {
      const { number, wire } = this.tag(), field = schema[number];
      if (!field) { this.skip(number, wire); continue; }
      const [key, type] = field;
      if (type === 'string' || typeof type === 'object') {
        check(wire === 2);
        const bytes = this.take(Number(this.varint()));
        if (type === 'string') {
          try { target[key] = utf8.decode(bytes); } catch { check(false); }
        } else target[key] = new Reader(bytes).message(type, target[key]);
        continue;
      }
      check(wire === 0);
      const value = this.varint();
      if (type === 'int64') target[key] = BigInt.asIntN(64, value).toString();
      else if (type === 'int32') target[key] = Number(BigInt.asIntN(32, value));
      else if (type === 'bool') target[key] = value !== 0n;
      else {
        check(value <= 0xffffffffn);
        target[key] = Number(value);
      }
    }
    return target;
  }
}

export function decodeCryptoReport(bytes) {
  check(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= 480_000);
  return new Reader(bytes).message(report);
}
