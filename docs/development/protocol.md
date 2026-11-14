# Omnik WiFi module protocols

How the app talks to the WiFi module. The code links here instead of repeating these tables.

## Binary protocol, TCP port 8899

Used for polling when it works, because it has more data than HTTP.

### Request (16 bytes, `OmnikProtocol.buildRequest`)

| Bytes | Content |
| --- | --- |
| 0–3 | header `68 02 40 30` |
| 4–7 | WiFi module S/N as 4 bytes, little-endian |
| 8–11 | the same S/N again |
| 12–13 | command `01 00` |
| 14 | checksum: low byte of 115 + sum of bytes 4–11 |
| 15 | end `16` |

The S/N must fit in 32 bits. Some modules with a S/N starting with 604 or 646 have a larger number; those can't use this protocol and are polled over HTTP.

### Response (`OmnikProtocol.parseResponse`)

Offsets follow the InverterMsg format from Woutrrr/Omnik-Data-Logger. A response of 70 bytes or less is an error or acknowledgement, not data.

| Offset | Field | Encoding |
| --- | --- | --- |
| 15–30 | inverter name | ASCII, 16 bytes |
| 31 | temperature | Int16BE, /10 °C |
| 51, 53, 55 | AC voltage L1/L2/L3 | Int16BE, /10 V; the app averages the positive phases |
| 57 | AC frequency | UInt16BE, /100 Hz |
| 59, 63, 67 | AC power L1/L2/L3 | Int16BE, W; the app sums the positive phases |
| 69 | energy today | UInt16BE, /100 kWh |
| 71 | energy lifetime | UInt32BE, /10 kWh |

Sensors a model doesn't have report `0xFFFF` (UInt16), `0xFFFFFFFF` (UInt32) or `-1` (Int16). The parser turns them into `NaN`; written as-is they would show up as 655.35 kWh.

A response can arrive in several TCP chunks, so the client collects chunks until the stream is quiet for 500 ms.

## HTTP, `/js/status.js` on port 80

Used during pairing (it contains the WiFi module S/N) and as fallback for polling. It has no voltage, frequency or temperature.

- `var m2mMid = "..."`: WiFi module S/N
- `var wlanMac = "..."`, `var version = "..."`: MAC address and WiFi firmware
- the inverter fields are in `webData = "..."` (older firmware) or `myDeviceArray[0] = "..."` (newer firmware, #1), comma-separated:

| Index | Field |
| --- | --- |
| 0 | inverter S/N |
| 1 | master firmware |
| 2 | slave firmware |
| 3 | model, e.g. `omnik3000tl` |
| 4 | rated power (W) |
| 5 | current AC power (W) |
| 6 | energy today, 0.01 kWh |
| 7 | energy lifetime, 0.1 kWh |
| 9 | status (1 idle, 2 or 3 generating) |

An empty `myDeviceArray` or `yz_device_num = "0"` while `m2mMid` is present means the inverter is asleep, not that the firmware is unsupported. The page can also hold the home Wi-Fi name and key; the diagnostic report redacts those.

Some modules require basic auth (often `admin`/`admin`).

## Discovery (not used yet)

- MAC prefixes seen on Omnik modules: `AC:CF:23` and `F0:FE:6B`, both Hi-Flying (the WiFi chip vendor, also used in other IoT devices).
- XtheOne/Inverter-Data-Logger finds modules with a UDP broadcast of `WIFIKIT-214028-READ` to port 48899; modules answer `IP,MAC,S/N`. Not yet verified against an Omnik module from Homey.
