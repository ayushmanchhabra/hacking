#!/usr/bin/env python3
 """
 ssl_bypass.py — The `ssl_crypto_x509_session_verify_cert_chain` function in BoringSSL's `ssl_x509.cc` file return 1 if valid and 0 if invalid. This script finds that function offset in AOS and iOS applications and creates a Frida script to force return `0x1`.

Usage: python ssl_bypass.py -h
 Requires: lief ; capstone (armeabi-v7a / x86 only).
 FOR AUTHORIZED SECURITY TESTING ONLY.

Per target: locate the ssl_client/ssl_server string anchors, scan code for theinstructions that load them (arm64 ADRP+ADD/LDR, x86_64 RIP-relative LEA, a rm32 MOVW/MOVT+ADD-pc / PC-relative LDR), then pick the function referencing BOTH with the smallest gap — the SSL_is_server(ssl)?"ssl_client":"ssl_server" select in ssl_crypto_x509_session_verify_cert_chain. Function bounds come from LIEF's function table (unwind info / LC_FUNCTION_STARTS / symbols); if empty, the arm64 engine walks back to a prologue. Emits per-target Frida scripts + a combined one.
 """

import sys, struct, re, bisect, argparse
 from collections import defaultdict
 import lief

# ───────────────────────── LIEF front-end ─────────────────────────

def load(path):
 raw = open(path, "rb").read()
 b = lief.ELF.parse(path)
 m = str(b.header.machine_type)
 if "AARCH64" in m: arch = "arm64"
 elif "X86_64" in m: arch = "x86_64"
 elif "ARM" in m: arch = "arm" # EM_ARM (32-bit)
 elif "I386" in m or "x86" in m.lower() or "386" in m: arch = "x86"
 else: raise SystemExit(f"[-] unsupported machine: {m}")
 return raw, b, arch

ENGINE_MODE = "auto" # auto | manual | lief (set from --engine)

def lief_has_disasm():
 """True only on a LIEF-Extended build that actually disassembles."""
 try:
 return bool(getattr(lief, "__extended__", False))
 except Exception:
 return False

def seg_type(s):
 try: return str(s.type)
 except Exception: return ""

def scan_lief(b, code, base_va, sc_va, ss_va, starts, label):
 """LIEF-Extended engine: disassemble .text once; an anchor xref is any
 instruction whose rendered form resolves to a string VA, branch targets add
 function entries. Returns RVA, or None so 'auto' falls back to manual."""
 cfo, cva, csz = code
 end = cva + csz
 sc_refs, ss_refs = [], []
 entries = set(starts or [])
 hexre = re.compile(r'0x[0-9a-fA-F]+')
 try:
 for inst in b.disassemble(cva):
 a = getattr(inst, "address", None)
 if a is None or a < cva: continue
 if a >= end: break
 try:
 if inst.is_branch and inst.branch_target is not None:
 entries.add(int(inst.branch_target) & ~1)
 except Exception:
 pass
 for h in hexre.findall(str(inst)):
 v = int(h, 16)
 if v == sc_va: sc_refs.append(a)
 elif v == ss_va: ss_refs.append(a)
 except Exception as e:
 print(f"[{label}] [!] LIEF disasm failed ({e})")
 return None
 print(f"[{label}] [+] (LIEF) ssl_client refs: {[hex(x) for x in sc_refs]} "
 f"ssl_server refs: {[hex(x) for x in ss_refs]}")
 entry, _ = select_verify(sc_refs, ss_refs, sorted(entries) or None, label)
 return None if entry is None else entry - base_va

def code_region(b):
 """Scan bounds (file_offset, vaddr, size): .text if present, else first exec PT_LOAD."""
 try:
 t = b.get_section(".text")
 if t and t.size:
 return (t.offset, t.virtual_address, t.size)
 except Exception:
 pass
 for s in b.segments:
 if seg_type(s).endswith("LOAD") and (int(s.flags) & 1): # PF_X
 return (s.file_offset, s.virtual_address, s.physical_size)
 return None

def function_starts(b):
 """Sorted function-entry VAs from LIEF (unwind tables/symbols), Thumb bit masked. None if empty."""
 try:
 s = sorted({f.address & ~1 for f in b.functions})
 except Exception:
 s = []
 return s or None

def func_start_before(starts, va):
 i = bisect.bisect_right(starts, va) - 1
 return starts[i] if i >= 0 else None

# ───────────────────── verify-function selector ─────────────────────

def _nearest_pair(sc, ss):
 best = None
 for a in sc:
 for b in ss:
 d = abs(a - b)
 if best is None or d < best[0]: best = (d, min(a, b))
 return best[1] if best else None

def select_verify(sc, ss, starts, label):
 if not sc or not ss:
 print(f"[-] [{label}] missing refs to one/both anchors"); return None, None
 if starts:
 grouped = defaultdict(lambda: [[], []])
 for a in sc:
 f = func_start_before(starts, a); grouped[f][0].append(a) if f is not None else None
 for a in ss:
 f = func_start_before(starts, a); grouped[f][1].append(a) if f is not None else None
 cands = []
 for f, (x, y) in grouped.items():
 if x and y:
 gap = min(abs(a - b) for a in x for b in y)
 cands.append((gap, f))
 if cands:
 cands.sort()
 gap, f = cands[0]
 print(f"[*] [{label}] {len(cands)} func(s) ref both anchors; picked 0x{f:x} (gap 0x{gap:x})")
 if len(cands) > 1:
 print(f"[*] [{label}] other both-anchor funcs (helpers): " +
 ", ".join(hex(c[1]) for c in cands[1:]))
 return f, _nearest_pair(sc, ss)
 print(f"[!] [{label}] no single func refs both; prologue fallback")
 return None, _nearest_pair(sc, ss)

# ───────────────────────────── engines ─────────────────────────────

def scan_arm64(data, code, base_va, sc_va, ss_va, starts):
 cfo, cva, csz = code
 def f2v(fo): return fo - cfo + cva
 def refs(target):
 lo12 = target & 0xfff; out = []
 for fi in range(cfo, cfo + csz - 4, 4):
 ins = struct.unpack_from('<I', data, fi)[0]
 if (ins & 0xffc00000) == 0x91000000 and ((ins >> 10) & 0xfff) == lo12 and fi >= 4:
 adrp = struct.unpack_from('<I', data, fi-4)[0]
 if (adrp & 0x9f000000) == 0x90000000:
 immlo=(adrp>>29)&3; immhi=(adrp>>5)&0x7ffff
 imm=((immhi<<2)|immlo)<<12
 if imm & (1<<32): imm -= (1<<33)
 if ((f2v(fi-4) & ~0xfff) + imm) == (target & ~0xfff):
 out.append(f2v(fi))
 return out
 sc, ss = refs(sc_va), refs(ss_va)
 print(f"[*] [arm64] ssl_client refs: {[hex(x) for x in sc]}")
 print(f"[*] [arm64] ssl_server refs: {[hex(x) for x in ss]}")
 entry, nearest = select_verify(sc, ss, starts, "arm64")
 if entry is not None:
 fo = entry - cva + cfo
 print(f"[+] [arm64] first bytes: {data[fo:fo+16].hex(' ')}")
 return entry - base_va
 if nearest is None: return None
 sfo = nearest - cva + cfo
 for i in range(sfo, max(cfo, sfo-0x400), -4):
 ins = struct.unpack_from('<I', data, i)[0]
 sub = (ins & 0xff8003ff) == 0xd10003ff
 stp = (ins & 0xffe07fff) == 0xa9007bfd
 if sub or stp:
 entry = i
 if stp and i-4 >= cfo and (struct.unpack_from('<I',data,i-4)[0] & 0xff8003ff)==0xd10003ff:
 entry = i-4
 return f2v(entry) - base_va
 return None

def scan_x86_64(data, code, base_va, sc_va, ss_va, starts):
 cfo, cva, csz = code
 def f2v(fo): return fo - cfo + cva
 def lea(target):
 out=[]; i=cfo; hi=cfo+csz-7
 while i < hi:
 if data[i] in (0x48,0x49,0x4C,0x4D) and data[i+1]==0x8D and (data[i+2]&0xC7)==0x05:
 disp=struct.unpack_from('<i',data,i+3)[0]
 if f2v(i)+7+disp == target: out.append(f2v(i))
 i+=1
 return out
 sc, ss = lea(sc_va), lea(ss_va)
 print(f"[*] [x86_64] ssl_client refs: {[hex(x) for x in sc]}")
 print(f"[*] [x86_64] ssl_server refs: {[hex(x) for x in ss]}")
 entry, nearest = select_verify(sc, ss, starts, "x86_64")
 if entry is not None:
 fo = entry - cva + cfo
 print(f"[+] [x86_64] first bytes: {data[fo:fo+16].hex(' ')}")
 return entry - base_va
 if nearest is None: return None
 # prologue fallback: nearest padding gap before the ref
 rfo = nearest - cva + cfo; lo = max(cfo, rfo-0x800)
 def pad(i):
 b=data[i]
 return b in (0xCC,0x90) or data[i:i+2]==b'\x0f\x1f' or (b==0x66 and data[i+1:i+2]==b'\x90')
 i=rfo-1
 while i>lo:
 if pad(i):
 j=i
 while j>=lo and pad(j): j-=1
 return f2v(j+1) - base_va
 i-=1
 return None

def scan_arm32(data, code, base_va, sc_va, ss_va, starts):
 try: import capstone as cs
 except ImportError:
 print("[-] armeabi-v7a needs capstone: pip install capstone"); return None
 cfo, cva, csz = code
 def f2v(fo): return fo - cfo + cva
 def a4(x): return x & ~3
 md = cs.Cs(cs.CS_ARCH_ARM, cs.CS_MODE_THUMB)
 ldr_re = re.compile(r'^(\w+), \[pc, #(?:0x)?([0-9a-fA-F]+)\]$')
 imm_re = re.compile(r'^(\w+), #(?:0x)?([0-9a-fA-F]+)$')
 startset = set(starts) if starts else set()
 regs = {}; sc=[]; ss=[]
 pos = cva; end = cva + csz; guard = 0
 while pos < end:
 progressed = False
 sfo = pos - cva + cfo
 for (addr,size,mnem,ops) in md.disasm_lite(data[sfo:end-cva+cfo], pos):
 progressed = True
 if addr in startset: regs = {}
 if mnem in ('ldr','ldr.w'):
 m = ldr_re.match(ops)
 if m:
 pool = a4(addr+4)+int(m.group(2),16); fo = pool-cva+cfo
 if 0 <= fo <= len(data)-4:
 regs[m.group(1)] = ('lit', struct.unpack_from('<i',data,fo)[0])
 else: regs.pop(m.group(1), None)
 else: regs.pop(ops.split(',')[0].strip(), None)
 elif mnem == 'movw':
 m = imm_re.match(ops)
 if m: regs[m.group(1)] = ('wt', int(m.group(2),16)&0xffff)
 elif mnem == 'movt':
 m = imm_re.match(ops)
 if m:
 r=m.group(1); cur=regs.get(r)
 base = cur[1] if (cur and cur[0]=='wt') else 0
 regs[r] = ('wt', (base&0xffff)|((int(m.group(2),16)&0xffff)<<16))
 elif mnem in ('add','add.w'):
 parts=[p.strip() for p in ops.split(',')]
 if parts and parts[-1]=='pc':
 rd=parts[0]; cur=regs.get(rd)
 if cur:
 tgt=(addr+4+cur[1]) & 0xffffffff
 if tgt==sc_va: sc.append(addr)
 elif tgt==ss_va: ss.append(addr)
 regs.pop(rd, None)
 pos = addr + size
 pos += 2; guard += 1
 if guard > csz: break
 print(f"[*] [armeabi-v7a] ssl_client refs: {[hex(x) for x in sc]}")
 print(f"[*] [armeabi-v7a] ssl_server refs: {[hex(x) for x in ss]}")
 entry, nearest = select_verify(sc, ss, starts, "armeabi-v7a")
 if entry is not None:
 fo = entry - cva + cfo
 print(f"[+] [armeabi-v7a] first bytes: {data[fo:fo+16].hex(' ')}")
 return entry - base_va
 if nearest is None: return None
 flo = max(cfo, (nearest-cva+cfo)-0x400); fhi=(nearest-cva+cfo)+2
 last=None
 for insn in md.disasm(data[flo:fhi], f2v(flo)):
 if insn.mnemonic in ('push','push.w') and 'lr' in insn.op_str: last=insn.address
 return (last - base_va) if last is not None else None

def scan_x86_32(*a):
 print("[!] x86 (32-bit) uses __x86.get_pc_thunk PIC; static resolution is "
 "unreliable. Use x86_64 or hook dynamically. Skipping.")
 return None

# ───────────────────────────── driver ─────────────────────────────

FRIDA = """// flutter_bypass{suffix}.js — {machine}. Authorized testing only.
 var MODULE = "{module}";
 var OFFSET = {rva}; // ssl_crypto_x509_session_verify_cert_chain (module.base + RVA)
 function hook() {{
 var m = Process.findModuleByName(MODULE);
 if (!m) {{ setTimeout(hook, 200); return; }}
 var addr = m.base.add(OFFSET);
 Interceptor.attach(addr, {{ // Interceptor handles the Thumb bit on arm32
 onLeave: function (r) {{ r.replace(0x1); }} // force cert chain = valid
 }});
 console.log("[+] hooked " + MODULE + "@" + OFFSET + " -> " + addr);
 }}
 hook();
 """

COMBINED = """// flutter_bypass_all.js — auto-selects the offset for the running ABI.
 // Authorized testing only. Generated by flutter_ssl_offset.py
 var OFFSETS = {table}; // Process.arch -> RVA in libflutter.so
 function hook() {{
 var m = Process.findModuleByName("libflutter.so");
 if (!m) {{ setTimeout(hook, 200); return; }}
 var off = OFFSETS[Process.arch];
 if (off === undefined) {{ console.log("[-] no offset for arch " + Process.arch); return; }}
 var addr = m.base.add(off);
 Interceptor.attach(addr, {{ // Interceptor handles the Thumb bit on arm32
 onLeave: function (r) {{ r.replace(0x1); }} // force cert chain = valid
 }});
 console.log("[+] (" + Process.arch + ") hooked libflutter.so@" + off + " -> " + addr);
 }}
 hook();
 """

# map our abi -> Frida Process.arch token
 FRIDA_ARCH = {"arm64-v8a":"arm64", "armeabi-v7a":"arm", "x86_64":"x64", "x86":"ia32"}

def analyze_so(path, label=""):
 """Return (abi, rva) for one libflutter.so, or (abi|None, None)."""
 tag = f"[{label}] " if label else ""
 raw, b, arch = load(path)
 code = code_region(b)
 abi = {"arm64":"arm64-v8a","x86_64":"x86_64","arm":"armeabi-v7a","x86":"x86"}[arch]
 if code is None:
 print(f"{tag}[-] no executable LOAD segment"); return abi, None
 cfo, cva, csz = code
 base_va = b.imagebase
 print(f"{tag}[*] arch={arch} code vaddr=0x{cva:x} size=0x{csz:x}")

 sc = [b.offset_to_virtual_address(m.start()) for m in re.finditer(b'ssl_client\x00', raw)]
 ss = [b.offset_to_virtual_address(m.start()) for m in re.finditer(b'ssl_server\x00', raw)]
 if not sc or not ss:
 print(f"{tag}[-] ssl_client/ssl_server not found — not a Flutter engine?"); return abi, None
 print(f"{tag}[+] ssl_client @ {[hex(x) for x in sc]} ssl_server @ {[hex(x) for x in ss]}")

 starts = function_starts(b) # LIEF: from .eh_frame_hdr / .ARM.exidx / symbols
 print(f"{tag}[+] {len(starts) if starts else 0} function starts (LIEF)")

 rva = None
 use_lief = ENGINE_MODE == "lief" or (ENGINE_MODE == "auto" and lief_has_disasm())
 if use_lief:
 print(f"{tag}[*] engine: LIEF disassembler")
 rva = scan_lief(b, code, base_va, sc[0], ss[0], starts, label or abi)
 if rva is None and ENGINE_MODE == "auto":
 print(f"{tag}[!] LIEF path found nothing — falling back to manual engine")
 if rva is None and ENGINE_MODE != "lief":
 engine = {"arm64":scan_arm64, "x86_64":scan_x86_64, "arm":scan_arm32, "x86":scan_x86_32}[arch]
 rva = engine(raw, code, base_va, sc[0], ss[0], starts)
 if rva is None:
 print(f"{tag}[-] could not resolve verify function"); return abi, None
 print(f"{tag}[=] {abi}: SSL verify RVA = 0x{rva:x}")
 return abi, rva

def find_flutter_in_apk(apk_path):
 """Return {abi: zip_entry} for every lib/<abi>/libflutter.so in the APK."""
 import zipfile
 found = {}
 with zipfile.ZipFile(apk_path) as z:
 for n in z.namelist():
 m = re.search(r'lib/([^/]+)/libflutter\.so$', n)
 if m: found[m.group(1)] = n
 return found

def run_apk(apk_path, out_dir):
 import zipfile, os, tempfile
 arches = find_flutter_in_apk(apk_path)
 if not arches:
 raise SystemExit("[-] no lib/<abi>/libflutter.so in APK — is this a Flutter app? "
 "(the engine may be a runtime-downloaded module)")
 print(f"[*] libflutter.so ABIs in APK: {', '.join(sorted(arches))}\n")
 results = {}
 tmp = tempfile.mkdtemp(prefix="libflutter_")
 with zipfile.ZipFile(apk_path) as z:
 for abi in sorted(arches):
 print("="*64)
 dst = os.path.join(tmp, f"libflutter_{abi}.so")
 with z.open(arches[abi]) as src, open(dst, "wb") as f:
 f.write(src.read())
 got_abi, rva = analyze_so(dst, label=abi)
 if rva is not None:
 results[got_abi] = rva
 open(os.path.join(out_dir, f"flutter_bypass_{got_abi}.js"), "w").write(
 FRIDA.format(suffix="_"+got_abi, machine=got_abi, rva=hex(rva), module="libflutter.so"))
 print()
 if not results:
 raise SystemExit("[-] no offsets resolved")
 # combined, arch-selecting Frida script
 table = "{ " + ", ".join(f'"{FRIDA_ARCH[a]}": {hex(r)}' for a, r in results.items()) + " }"
 combined = os.path.join(out_dir, "flutter_bypass_all.js")
 open(combined, "w").write(COMBINED.format(table=table))
 print("="*64)
 print("[=] RESULTS")
 for a, r in sorted(results.items()):
 print(f" {a:<14} RVA = 0x{r:x} (Frida Process.arch='{FRIDA_ARCH[a]}')")
 print(f"[+] per-ABI scripts + combined: {combined}")
 print(f"[*] run against the SAME ABI your device/emulator uses:")
 print(f" frida -U -f <package> -l flutter_bypass_all.js")

# ─────────────────────────── iOS (Mach-O) ───────────────────────────
 # Flutter.framework's arm64 Mach-O, same BoringSSL anchors. Runtime module "Flutter".

def analyze_macho(path, label=""):
 """Return ('ios-arm64', rva) for a Flutter.framework binary, or (.., None)."""
 tag = f"[{label}] " if label else ""
 fat = lief.MachO.parse(path)
 bin_ = None
 for sl in fat:
 if "ARM64" in str(sl.header.cpu_type):
 bin_ = sl; break
 if bin_ is None:
 print(f"{tag}[-] no arm64 slice in Mach-O"); return "ios-arm64", None

 # __TEXT (r-x) holds both code and the __cstring anchors; scan it directly.
 exec_seg = None
 for s in bin_.segments:
 if (s.init_protection & 0x4): # VM_PROT_EXECUTE
 exec_seg = s; break
 if exec_seg is None:
 print(f"{tag}[-] no executable Mach-O segment"); return "ios-arm64", None

 data = bytes(exec_seg.content)
 cva = exec_seg.virtual_address
 code = (0, cva, len(data)) # cfo=0: offsets are segment-relative
 base_va = bin_.imagebase # __TEXT base == module base for RVA
 print(f"{tag}[*] arch=ios-arm64 __TEXT vaddr=0x{cva:x} size=0x{len(data):x}")

 sc = [cva + m.start() for m in re.finditer(b'ssl_client\x00', data)]
 ss = [cva + m.start() for m in re.finditer(b'ssl_server\x00', data)]
 if not sc or not ss:
 print(f"{tag}[-] ssl_client/ssl_server not found in __TEXT — not a Flutter framework?")
 return "ios-arm64", None
 print(f"{tag}[+] ssl_client @ {[hex(x) for x in sc]} ssl_server @ {[hex(x) for x in ss]}")

 # LC_FUNCTION_STARTS via LIEF for exact bounds; else scan_arm64 prologue walk.
 starts = function_starts(bin_)
 print(f"{tag}[+] {len(starts) if starts else 0} function starts (LIEF)")

 rva = None
 use_lief = ENGINE_MODE == "lief" or (ENGINE_MODE == "auto" and lief_has_disasm())
 if use_lief:
 print(f"{tag}[*] engine: LIEF disassembler")
 rva = scan_lief(bin_, code, base_va, sc[0], ss[0], starts, label or "ios")
 if rva is None and ENGINE_MODE == "auto":
 print(f"{tag}[!] LIEF path found nothing — falling back to manual engine")
 if rva is None and ENGINE_MODE != "lief":
 rva = scan_arm64(data, code, base_va, sc[0], ss[0], starts)
 if rva is None:
 print(f"{tag}[-] could not resolve verify function"); return "ios-arm64", None
 print(f"{tag}[=] ios-arm64: SSL verify RVA = 0x{rva:x}")
 return "ios-arm64", rva

def find_flutter_in_ipa(ipa_path):
 """Return the zip entry of Payload/<App>.app/Frameworks/Flutter.framework/Flutter."""
 import zipfile
 with zipfile.ZipFile(ipa_path) as z:
 for n in z.namelist():
 if re.search(r'Payload/[^/]+\.app/Frameworks/Flutter\.framework/Flutter$', n):
 return n
 return None

def run_ipa(ipa_path, out_dir):
 import zipfile, os, tempfile
 entry = find_flutter_in_ipa(ipa_path)
 if not entry:
 raise SystemExit("[-] no Flutter.framework/Flutter in IPA — is this a Flutter app?")
 print(f"[*] Flutter framework: {entry}\n" + "="*64)
 tmp = tempfile.mkdtemp(prefix="flutter_ios_")
 dst = os.path.join(tmp, "Flutter")
 with zipfile.ZipFile(ipa_path) as z, z.open(entry) as src, open(dst, "wb") as f:
 f.write(src.read())
 abi, rva = analyze_macho(dst, label="ios")
 if rva is None:
 raise SystemExit("[-] no offset resolved")
 out = os.path.join(out_dir, "flutter_bypass_ios.js")
 open(out, "w").write(FRIDA.format(suffix="_ios", machine="ios-arm64", rva=hex(rva), module="Flutter"))
 print("="*64)
 print(f"[=] RESULTS\n ios-arm64 RVA = 0x{rva:x} (module 'Flutter')")
 print(f"[+] Frida script: {out}")
 print(f"[*] jailbroken device: frida -U -f <bundle-id> -l {os.path.basename(out)}")

# ─────────────────────── input autodetect + dispatch ───────────────────────

def classify(path):
 """Return 'ipa' | 'apk' | 'macho' | 'elf' from contents (not just extension)."""
 import zipfile
 if zipfile.is_zipfile(path):
 with zipfile.ZipFile(path) as z:
 names = z.namelist()
 if any(re.search(r'Payload/[^/]+\.app/Frameworks/Flutter\.framework/Flutter$', n) for n in names):
 return "ipa"
 if any(re.search(r'lib/[^/]+/libflutter\.so$', n) for n in names):
 return "apk"
 # fall back to extension for odd zips
 return "ipa" if path.lower().endswith(".ipa") else "apk"
 with open(path, "rb") as f:
 magic = f.read(4)
 if magic == b"\x7fELF": return "elf"
 if magic in (b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa\xcf"): return "macho"
 raise SystemExit(f"[-] unrecognized input (magic {magic!r}); expected .apk/.ipa/libflutter.so/Flutter")

def main():
 import os
 ap = argparse.ArgumentParser(description="LIEF Flutter BoringSSL verify-offset finder — Android + iOS (authorized testing only)")
 ap.add_argument("input", help=".apk (every Android ABI) | .ipa (iOS) | a single libflutter.so | a Flutter.framework binary")
 ap.add_argument("-o", "--out", default=None, help="output dir (apk/ipa) or Frida script path (single binary)")
 ap.add_argument("--engine", choices=["auto", "manual", "lief"], default="auto",
 help="auto: LIEF disassembler if LIEF-Extended is installed, else the "
 "built-in decoders; manual: force built-in decoders; lief: force "
 "the LIEF disassembler (requires LIEF-Extended)")
 a = ap.parse_args()

 global ENGINE_MODE
 ENGINE_MODE = a.engine
 if ENGINE_MODE == "lief" and not lief_has_disasm():
 raise SystemExit("[-] --engine lief needs LIEF-Extended (lief.__extended__ is False). "
 "Install the extended wheel from https://extended.lief.re/ or use --engine auto.")
 print(f"[*] engine mode: {ENGINE_MODE} (LIEF-Extended disassembler "
 f"{'available' if lief_has_disasm() else 'not installed'})")

 kind = classify(a.input)
 out_dir = a.out or os.path.dirname(os.path.abspath(a.input)) or "."

 if kind == "apk":
 os.makedirs(out_dir, exist_ok=True); run_apk(a.input, out_dir)
 elif kind == "ipa":
 os.makedirs(out_dir, exist_ok=True); run_ipa(a.input, out_dir)
 elif kind == "macho": # single Flutter.framework binary
 abi, rva = analyze_macho(a.input)
 if rva is None: raise SystemExit(1)
 out = a.out or "flutter_bypass_ios.js"
 open(out, "w").write(FRIDA.format(suffix="_ios", machine="ios-arm64", rva=hex(rva), module="Flutter"))
 print(f"[+] Frida script: {out}")
 else: # single libflutter.so
 abi, rva = analyze_so(a.input)
 if rva is None: raise SystemExit(1)
 out = a.out or f"flutter_bypass_{abi}.js"
 open(out, "w").write(FRIDA.format(suffix="_"+abi, machine=abi, rva=hex(rva), module="libflutter.so"))
 print(f"[+] Frida script: {out}")

if __name__ == "__main__":
 main()
