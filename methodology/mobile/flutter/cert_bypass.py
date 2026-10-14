#!/usr/bin/env python3 
""" 
Bypass Dio 5's ValidateCertificate pinning by spoofing a peer x509 object. 

Static (LIEF): locate WrappedX509Certificate (refs the "X509Certificate" string) 
and X509_free candidates (thin OPENSSL_memory_free wrappers). Runtime (Frida): 
PEM_read_X509 a real server cert from an external libcrypto, swap it in at 
WrappedX509Certificate, and no-op its free so the spoof isn't freed. 

Cert swap: arm64-v8a / x86_64 / armeabi-v7a. Free guard: static X509_free on 
arm64, plus a runtime OPENSSL_memory_free guard on every arch. 
Input auto-detected: .apk | .ipa | bare libflutter.so / Flutter binary. 

Usage: python3 dio_validatecert_bypass.py <app.apk|app.ipa|libflutter.so> --host HOST [-o OUT] 
Requires: lief ; capstone (x86_64 / armeabi-v7a). FOR AUTHORIZED SECURITY TESTING ONLY. 
Reference: https://d0ublew.github.io/notes/mobile/dio-validatecertificate-pinning-bypass/index.html#final-frida-script 
""" 
import sys, re, struct, bisect, argparse, os, tempfile, zipfile 
import lief 

# ───────────────────────────── LIEF helpers ───────────────────────────── 

def text_region(b): 
 """(file_off, vaddr, size) of .text, else first exec PT_LOAD.""" 
 try: 
 t = b.get_section(".text") 
 if t and t.size: return (t.offset, t.virtual_address, t.size) 
 except Exception: pass 
 for s in b.segments: 
 if str(s.type).endswith("LOAD") and (int(s.flags) & 1): # flag bit 1 = PF_X (executable) 
 return (s.file_offset, s.virtual_address, s.physical_size) 
 return None 

def func_starts(b): 
 try: return sorted({f.address & ~1 for f in b.functions}) 
 except Exception: return [] 

def enclosing(starts, va): 
 i = bisect.bisect_right(starts, va) - 1 
 return starts[i] if i >= 0 else None 

def next_start(starts, va, hi): 
 i = bisect.bisect_right(starts, va) 
 return starts[i] if i < len(starts) else hi 

def str_vas(raw, b, s): 
 return [b.offset_to_virtual_address(m.start()) for m in re.finditer(re.escape(s), raw)] 

# ─────────────────────── arch-specific xref scans ─────────────────────── 
# Find code sites that load a given string VA (to locate WrappedX509Certificate). 

def xrefs_arm64(raw, cfo, cva, csz, target): 
 # ARM64 loads a string addr as ADRP xD,page ; ADD xD,xD,#lo12. Match the pair. 
 lo12 = target & 0xfff # low 12 bits the ADD contributes 
 out = [] 
 for fi in range(cfo, cfo + csz - 4, 4): # fixed 4-byte insns 
 ins = struct.unpack_from('<I', raw, fi)[0] 
 # ADD (imm,64-bit): opcode bits 0x91000000; imm12 sits at bits [21:10] 
 if (ins & 0xffc00000) == 0x91000000 and ((ins >> 10) & 0xfff) == lo12 and fi >= 4: 
 adrp = struct.unpack_from('<I', raw, fi-4)[0] # preceding insn should be ADRP 
 if (adrp & 0x9f000000) == 0x90000000: # ADRP opcode bits 
 immlo=(adrp>>29)&3; immhi=(adrp>>5)&0x7ffff # 21-bit page imm, split lo/hi 
 imm=((immhi<<2)|immlo)<<12 # scale by page size (4 KiB) 
 if imm & (1<<32): imm -= (1<<33) # sign-extend 33-bit result 
 if ((fi-4-cfo+cva) & ~0xfff) + imm == (target & ~0xfff): # same 4 KiB page? 
 out.append(fi-cfo+cva) 
 return out 

def xrefs_x86_64(raw, cfo, cva, csz, target): 
 # x86-64 loads a string addr as LEA reg,[rip+disp32]. Scan for that encoding. 
 out=[]; i=cfo; hi=cfo+csz-7 
 while i < hi: 
 # REX.W prefix (0x48/0x49/0x4C/0x4D) ; 0x8D = LEA ; ModRM 0x05 = [rip+disp32] 
 if raw[i] in (0x48,0x49,0x4C,0x4D) and raw[i+1]==0x8D and (raw[i+2]&0xC7)==0x05: 
 disp=struct.unpack_from('<i',raw,i+3)[0] # signed 32-bit displacement 
 if (i-cfo+cva)+7+disp == target: out.append(i-cfo+cva) # rip = next insn (+7) 
 i += 1 
 return out 

def xrefs_arm32(raw, cfo, cva, csz, target): 
 try: import capstone as cs 
 except ImportError: 
 print("[-] armeabi-v7a needs capstone"); return [] 
 md = cs.Cs(cs.CS_ARCH_ARM, cs.CS_MODE_THUMB) 
 ldr_re=re.compile(r'^(\w+), \[pc, #(?:0x)?([0-9a-fA-F]+)\]$'); imm_re=re.compile(r'^(\w+), #(?:0x)?([0-9a-fA-F]+)$') 
 regs={}; out=[]; pos=cva; end=cva+csz; guard=0 
 while pos < end: 
 prog=False 
 for (addr,size,mnem,ops) in md.disasm_lite(raw[pos-cva+cfo:end-cva+cfo], pos): 
 prog=True 
 if mnem in ('ldr','ldr.w'): # LDR rD,[pc,#off] -> literal pool load 
 m=ldr_re.match(ops) 
 if m: 
 # literal pool base = (pc+4) rounded down to 4 bytes (&~3), + offset 
 pool=((addr+4)&~3)+int(m.group(2),16); fo=pool-cva+cfo 
 if 0<=fo<=len(raw)-4: regs[m.group(1)]=struct.unpack_from('<i',raw,fo)[0] 
 elif mnem=='movw': # MOVW rD,#imm -> low 16 bits 
 m=imm_re.match(ops) 
 if m: regs[m.group(1)]=int(m.group(2),16)&0xffff 
 elif mnem=='movt': # MOVT rD,#imm -> high 16 bits 
 m=imm_re.match(ops) 
 if m: regs[m.group(1)]=(regs.get(m.group(1),0)&0xffff)|((int(m.group(2),16)&0xffff)<<16) 
 elif mnem in ('add','add.w'): # ADD rD,pc -> finalize PC-relative addr 
 p=[x.strip() for x in ops.split(',')] 
 if p and p[-1]=='pc' and p[0] in regs: 
 # Thumb PC = insn addr + 4; &~1 clears the Thumb bit for comparison 
 if (addr+4+regs[p[0]])&~1 == target&~1 or (addr+4+regs[p[0]])==target: 
 out.append(addr) 
 pos=addr+size 
 pos += 2; guard+=1 
 if guard>csz: break 
 return out 

XREF = {"arm64":xrefs_arm64, "x86_64":xrefs_x86_64, "arm":xrefs_arm32} 

# ───────────────────── X509_free candidate finder (cross-arch) ───────────────────── 
# Pivot: LIEF's JUMP_SLOT reloc gives the OPENSSL_memory_free GOT slot per arch. 
# Reliable only on arm64; x86_64/arm32 usually return [] (runtime guard covers). 

def openssl_free_got(b): 
 for r in b.pltgot_relocations: # LIEF: PLT/GOT relocs only 
 try: 
 if r.has_symbol and r.symbol and r.symbol.name == "OPENSSL_memory_free": 
 return r.address 
 except Exception: pass 
 return None 

def _plt_stubs(b, arch, got): 
 """PLT stub entry VAs whose jump resolves to the OPENSSL_free GOT slot.""" 
 import capstone as cs 
 stubs = set() 
 if arch == "arm64": 
 # arm64 PLT stub loads the GOT entry as: ADRP x16,page ; LDR x17,[x16,#off] 
 for sec in b.sections: 
 if not (int(sec.flags) & 0x4): continue # 0x4 = SHF_EXECINSTR (exec section) 
 d = bytes(sec.content); base = sec.virtual_address 
 for i in range(0, len(d)-8, 4): 
 a = struct.unpack_from('<I', d, i)[0]; n = struct.unpack_from('<I', d, i+4)[0] 
 # 0x90000010 = ADRP into x16 ; 0xf9400211 = LDR x17,[x16,#imm] 
 if (a & 0x9f00001f) == 0x90000010 and (n & 0xffc003ff) == 0xf9400211: 
 immlo=(a>>29)&3; immhi=(a>>5)&0x7ffff; imm=((immhi<<2)|immlo)<<12 # ADRP page imm 
 if imm & (1<<32): imm -= (1<<33) # sign-extend 
 # page(&~0xfff) + ADRP imm + LDR offset(bits[21:10]*8) == GOT slot? 
 if ((base+i) & ~0xfff) + imm + ((n>>10)&0xfff)*8 == got: stubs.add(base+i) 
 elif arch == "x86_64": 
 from capstone.x86 import X86_OP_MEM, X86_REG_RIP 
 md = cs.Cs(cs.CS_ARCH_X86, cs.CS_MODE_64); md.detail = True 
 for nm in (".plt", ".plt.sec"): 
 s = b.get_section(nm) 
 if not s or not s.size: continue 
 for ins in md.disasm(bytes(s.content), s.virtual_address): 
 if ins.mnemonic == "jmp": # stub is: jmp qword [rip+disp] -> GOT 
 for op in ins.operands: 
 if op.type == X86_OP_MEM and op.mem.base == X86_REG_RIP \ 
 and ins.address + ins.size + op.mem.disp == got: 
 stubs.add(ins.address & ~0xf) # &~0xf -> 16-byte PLT entry start 
 elif arch == "arm": # .plt is ARM (A32) 
 from capstone.arm import ARM_OP_IMM, ARM_OP_MEM 
 s = b.get_section(".plt") 
 if s and s.size: 
 md = cs.Cs(cs.CS_ARCH_ARM, cs.CS_MODE_ARM); md.detail = True 
 ip = None; entry = None 
 for ins in md.disasm(bytes(s.content), s.virtual_address): 
 m = ins.mnemonic 
 if m.startswith("add") and "ip, pc" in ins.op_str: 
 entry = ins.address 
 imm = ins.operands[-1].imm if ins.operands and ins.operands[-1].type == ARM_OP_IMM else 0 
 ip = ins.address + 8 + imm 
 elif m.startswith("add") and "ip, ip" in ins.op_str and ip is not None: 
 ip += ins.operands[-1].imm if ins.operands and ins.operands[-1].type == ARM_OP_IMM else 0 
 elif m.startswith("ldr") and "pc, [ip" in ins.op_str and ip is not None: 
 disp = next((op.mem.disp for op in ins.operands if op.type == ARM_OP_MEM), 0) 
 if ip + disp == got and entry is not None: stubs.add(entry) 
 ip = None; entry = None 
 return stubs 

def x509_free_candidates(raw, b, arch, cfo, cva, csz, starts): 
 """Thin OPENSSL_free wrappers with an early arg0 NULL-check (X509_free look-alikes).""" 
 got = openssl_free_got(b) 
 if got is None: return [] 
 stubs = _plt_stubs(b, arch, got) 
 if not stubs: return [] 
 def nstart(f): return next_start(starts, f, cva+csz) 

 if arch == "arm64": # fast hand-decode (no capstone) 
 callers = set() 
 for fi in range(cfo, cfo+csz-4, 4): 
 ins = struct.unpack_from('<I', raw, fi)[0] 
 if (ins & 0xFC000000) == 0x94000000: # 0x94000000 = BL opcode 
 imm = ins & 0x03FFFFFF # 26-bit signed word offset 
 if imm & 0x02000000: imm -= 0x04000000 # sign-extend (bit 25) 
 if (fi-cfo+cva)+imm*4 in stubs: # *4: offset is in words 
 f = enclosing(starts, fi-cfo+cva) 
 if f: callers.add(f) 
 out = [] 
 for f in callers: 
 if nstart(f)-f > 0x200: continue # thin wrapper only (<= 0x200 bytes) 
 fo = f-cva+cfo 
 for k in range(fo, min(fo+32, cfo+csz)-3, 4): # first ~8 insns (0x20 bytes) 
 ins = struct.unpack_from('<I', raw, k)[0] 
 # 0x34000000=CBZ, 0x35000000=CBNZ ; & 0x1F == 0 -> operand register is x0/w0 
 if (ins & 0x7F000000) in (0x34000000, 0x35000000) and (ins & 0x1F) == 0: 
 out.append(f); break 
 return sorted(out) 

 import capstone as cs 
 from capstone import CS_GRP_CALL, CS_GRP_JUMP 
 if arch == "x86_64": 
 from capstone.x86 import X86_OP_IMM 
 md = cs.Cs(cs.CS_ARCH_X86, cs.CS_MODE_64); md.detail = True 
 op_imm = X86_OP_IMM; align = ~0xf; mode_size = 0x200 # align ~0xf: PLT entry start; size cap 0x200 
 def nullchk(code, base): 
 for i, ins in enumerate(md.disasm(code, base)): 
 if ins.mnemonic in ("test","cmp") and (ins.op_str in ("rdi, rdi","edi, edi") 
 or ins.op_str.startswith(("rdi, 0","edi, 0"))): 
 return True 
 if i >= 8: break 
 return False 
 elif arch == "arm": 
 from capstone.arm import ARM_OP_IMM 
 md = cs.Cs(cs.CS_ARCH_ARM, cs.CS_MODE_THUMB); md.detail = True 
 op_imm = ARM_OP_IMM; align = ~1; mode_size = 0x120 # align ~1: drop Thumb bit; size cap 0x120 
 def nullchk(code, base): 
 for i, ins in enumerate(md.disasm(code, base)): 
 if (ins.mnemonic == "cbz" and ins.op_str.startswith("r0")) \ 
 or (ins.mnemonic == "cmp" and ins.op_str.startswith("r0, #0")): 
 return True 
 if i >= 8: break 
 return False 
 else: 
 return [] 

 def call_tgt(ins): # capstone groups, not mnemonic strings 
 g = ins.groups 
 if (CS_GRP_CALL in g or CS_GRP_JUMP in g) and ins.operands and ins.operands[0].type == op_imm: 
 return ins.operands[0].imm & align 
 return None 
 callers = set() 
 for f in starts: 
 if not (cva <= f < cva+csz): continue 
 fo = f-cva+cfo 
 for ins in md.disasm(raw[fo:nstart(f)-cva+cfo], f): 
 t = call_tgt(ins) 
 if t is not None and t in stubs: callers.add(f); break 
 out = [f for f in callers 
 if nstart(f)-f <= mode_size and nullchk(raw[f-cva+cfo:f-cva+cfo+64], f)] 
 return sorted(out) 

# ───────────────────────────── analysis ───────────────────────────── 

def arch_of(b): 
 m = str(b.header.machine_type) 
 if "AARCH64" in m: return "arm64" 
 if "X86_64" in m: return "x86_64" 
 if "ARM" in m: return "arm" 
 return "x86" 

def analyze_elf(path, label=""): 
 tag = f"[{label}] " if label else "" 
 raw = open(path, "rb").read(); b = lief.ELF.parse(path) 
 arch = arch_of(b); tr = text_region(b) 
 if tr is None: print(f"{tag}[-] no .text"); return None 
 cfo, cva, csz = tr; starts = func_starts(b) 
 print(f"{tag}[*] arch={arch} module=libflutter.so") 

 xv = str_vas(raw, b, b"X509Certificate\x00") 
 if not xv: 
 print(f"{tag}[-] 'X509Certificate' string absent — not a Dio/validateCertificate build?") 
 return None 
 refs = XREF[arch](raw, cfo, cva, csz, xv[0]) if arch in XREF else [] 
 wrapper = None 
 for a in refs: 
 f = enclosing(starts, a) 
 if f: wrapper = f; break 
 if wrapper is None: 
 print(f"{tag}[-] could not resolve WrappedX509Certificate"); return None 
 print(f"{tag}[+] WrappedX509Certificate @ RVA 0x{wrapper:x}") 

 frees = x509_free_candidates(raw, b, arch, cfo, cva, csz, starts) 
 print(f"{tag}[+] X509_free candidates: {[hex(x) for x in frees]}") 
 if not frees: 
 print(f"{tag}[!] no thin static candidate ({arch} codegen) — relying on the " 
 f"runtime OPENSSL_memory_free guard") 
 return {"module": "libflutter.so", "arch": arch, "wrapper": wrapper, "frees": frees, 
 "reg": {"arm64":"x0","x86_64":"rdi","arm":"r0"}.get(arch,"x0")} 

def analyze_macho(path, label=""): 
 tag = f"[{label}] " if label else "" 
 fat = lief.MachO.parse(path); bn = None 
 for sl in fat: 
 if "ARM64" in str(sl.header.cpu_type): bn = sl; break 
 if bn is None: print(f"{tag}[-] no arm64 slice"); return None 
 seg = next((s for s in bn.segments if s.init_protection & 0x4), None) # 0x4 = VM_PROT_EXECUTE (__TEXT) 
 if seg is None: print(f"{tag}[-] no exec segment"); return None 
 data = bytes(seg.content); cva = seg.virtual_address 
 starts = func_starts(bn) 
 print(f"{tag}[*] arch=ios-arm64 module=Flutter") 
 xv = [cva + m.start() for m in re.finditer(b"X509Certificate\x00", data)] 
 if not xv: 
 print(f"{tag}[-] 'X509Certificate' string absent"); return None 
 refs = xrefs_arm64(data, 0, cva, len(data), xv[0]) 
 wrapper = next((enclosing(starts, a) for a in refs if enclosing(starts, a)), None) 
 if wrapper is None: print(f"{tag}[-] WrappedX509Certificate not resolved"); return None 
 print(f"{tag}[+] WrappedX509Certificate @ RVA 0x{wrapper:x}") 
 print(f"{tag}[!] X509_free static enum is ELF-only (Mach-O has no PLT reloc); " 
 f"relying on the runtime OPENSSL_memory_free guard") 
 return {"module": "Flutter", "arch": "ios-arm64", "wrapper": wrapper, "frees": [], "reg": "x0"} 

# ───────────────────────────── Frida output ───────────────────────────── 

FRIDA = r"""// dio_validatecert_bypass.js — {module} ({arch}). Authorized testing only. 
{setup} 
'use strict'; 
var MODULE = "{module}"; 
var WRAPPED = {wrapper}; // WrappedX509Certificate RVA 
var FREES = {frees}; // X509_free RVAs to guard 
var ARG_REG = "{reg}"; // arg0 register 

// EDIT THESE to match the push step above 
var PEM_PATH = "{pem}"; 
var LIBCRYPTO = "{libcrypto}"; 
var LIBSSL = "{libssl}"; 

var SPOOFED = null; 

function makeSpoofed() {{ 
 var crypto = Module.load(LIBCRYPTO); 
 try {{ Module.load(LIBSSL); }} catch (e) {{}} 
 var fopen = new NativeFunction(Module.getExportByName(null, "fopen"), "pointer", ["pointer","pointer"]); 
 var fclose = new NativeFunction(Module.getExportByName(null, "fclose"), "int", ["pointer"]); 
 var PEM_read_X509= new NativeFunction(crypto.getExportByName("PEM_read_X509"), "pointer", 
 ["pointer","pointer","pointer","pointer"]); 
 var fp = fopen(Memory.allocUtf8String(PEM_PATH), Memory.allocUtf8String("r")); 
 if (fp.isNull()) {{ console.log("[-] cannot open " + PEM_PATH); return; }} 
 SPOOFED = PEM_read_X509(fp, ptr(0), ptr(0), ptr(0)); 
 fclose(fp); 
 console.log(SPOOFED.isNull() ? "[-] PEM_read_X509 failed" : "[+] spoofed cert @ " + SPOOFED); 
}} 

function install() {{ 
 var m = Process.findModuleByName(MODULE); 
 if (!m) {{ setTimeout(install, 200); return; }} 
 makeSpoofed(); 
 if (SPOOFED === null || SPOOFED.isNull()) {{ console.log("[-] no spoofed cert; aborting"); return; }} 

 // swap arg0 (peer cert) for our real server cert 
 Interceptor.attach(m.base.add(WRAPPED), {{ 
 onEnter: function (args) {{ this.context[ARG_REG] = SPOOFED; }} 
 }}); 
 console.log("[+] hooked WrappedX509Certificate @ " + m.base.add(WRAPPED)); 

 // static X509_free guard (arm64): skip at entry, before the foreign-struct walk 
 FREES.forEach(function (off) {{ 
 var addr = m.base.add(off); 
 var orig = new NativeFunction(addr, "void", ["pointer"]); 
 Interceptor.replace(addr, new NativeCallback(function (x) {{ 
 if (!SPOOFED.isNull() && x.equals(SPOOFED)) return; 
 orig(x); 
 }}, "void", ["pointer"])); 
 }}); 
 console.log("[+] guarded " + FREES.length + " static X509_free candidate(s)"); 

 // runtime safety net (all arches): no-op OPENSSL_memory_free on the spoof 
 var of = Module.findExportByName(MODULE, "OPENSSL_memory_free") 
 || Module.findExportByName(null, "OPENSSL_memory_free"); 
 if (of) {{ 
 var ofo = new NativeFunction(of, "void", ["pointer"]); 
 Interceptor.replace(of, new NativeCallback(function (x) {{ 
 if (!SPOOFED.isNull() && x.equals(SPOOFED)) return; 
 ofo(x); 
 }}, "void", ["pointer"])); 
 console.log("[+] runtime guard on OPENSSL_memory_free @ " + of); 
 }} else {{ 
 console.log("[!] OPENSSL_memory_free not resolvable; free guard limited to static candidates"); 
 }} 
}} 
install(); 
""" 

SETUP_ANDROID = """// 
// BEFORE RUNNING (Android): 
// 1. Fetch the REAL server leaf cert (the host you're intercepting): 
// openssl s_client -connect {host}:443 -servername {host} </dev/null \\ 
// | openssl x509 -out server.pem 
// 2. Get an external OpenSSL for the device ABI (e.g. KDAB android_openssl: 
// libcrypto_1_1.so / libssl_1_1.so for {arch}). 
// 3. adb push server.pem libcrypto_1_1.so libssl_1_1.so /data/local/tmp/ 
// 4. Set PEM_PATH / LIBCRYPTO / LIBSSL below. 
// 5. Rooted device + frida-server, then: 
// frida -U -f <package> -l dio_validatecert_bypass.js""" 

SETUP_IOS = """// 
// BEFORE RUNNING (iOS, jailbroken): 
// 1. Fetch the REAL server leaf cert (the host you're intercepting): 
// openssl s_client -connect {host}:443 -servername {host} </dev/null \\ 
// | openssl x509 -out server.pem 
// 2. Get an arm64 OpenSSL for iOS (libcrypto.dylib / libssl.dylib, e.g. an 
// OpenSSL-for-iPhone build); a jailbroken device can dlopen it. 
// 3. Copy all three to the device over SSH-over-USB: 
// iproxy 2222 22 & 
// scp -P 2222 server.pem libcrypto.dylib libssl.dylib root@127.0.0.1:/var/root/ 
// 4. Set PEM_PATH / LIBCRYPTO / LIBSSL below. 
// 5. frida-server running on the device, then: 
// frida -U -f <bundle-id> -l dio_validatecert_bypass.js 
// NOTE: no static X509_free guard on iOS — relies on the runtime 
// OPENSSL_memory_free guard; if it won't resolve, the free must be handled manually.""" 

def write_frida(info, host, out): 
 ios = info["module"] == "Flutter" 
 setup = (SETUP_IOS if ios else SETUP_ANDROID).format(host=host, arch=info["arch"]) 
 if ios: 
 pem, libcrypto, libssl = "/var/root/server.pem", "/var/root/libcrypto.dylib", "/var/root/libssl.dylib" 
 else: 
 pem, libcrypto, libssl = ("/data/local/tmp/server.pem", 
 "/data/local/tmp/libcrypto_1_1.so", "/data/local/tmp/libssl_1_1.so") 
 frees = "[" + ", ".join(hex(x) for x in info["frees"]) + "]" 
 js = FRIDA.format(module=info["module"], arch=info["arch"], wrapper=hex(info["wrapper"]), 
 frees=frees, reg=info["reg"], host=host, setup=setup, 
 pem=pem, libcrypto=libcrypto, libssl=libssl) 
 open(out, "w").write(js) 
 print(f"[+] Frida script: {out}") 

# ───────────────────────────── driver ───────────────────────────── 

def classify(path): 
 if zipfile.is_zipfile(path): 
 with zipfile.ZipFile(path) as z: names = z.namelist() 
 if any(re.search(r'Payload/[^/]+\.app/Frameworks/Flutter\.framework/Flutter$', n) for n in names): 
 return "ipa" 
 if any(re.search(r'lib/[^/]+/libflutter\.so$', n) for n in names): 
 return "apk" 
 return "ipa" if path.lower().endswith(".ipa") else "apk" 
 with open(path, "rb") as f: magic = f.read(4) 
 if magic == b"\x7fELF": return "elf" # ELF magic (Android .so) 
 # Mach-O magics: cffaedfe (64-bit LE), cafebabe (fat), feedfacf (64-bit BE) — iOS Flutter 
 if magic in (b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa\xcf"): return "macho" 
 raise SystemExit(f"[-] unrecognized input (magic {magic!r})") 

def extract_apk_arm64(apk): 
 with zipfile.ZipFile(apk) as z: 
 ent = None 
 for pref in ("lib/arm64-v8a/libflutter.so",): 
 if pref in z.namelist(): ent = pref; break 
 if ent is None: 
 raise SystemExit("[-] no lib/arm64-v8a/libflutter.so in APK " 
 "(validateCertificate bypass needs the arm64 engine)") 
 dst = os.path.join(tempfile.mkdtemp(prefix="vc_"), "libflutter.so") 
 with z.open(ent) as s, open(dst, "wb") as f: f.write(s.read()) 
 return dst 

def extract_ipa(ipa): 
 with zipfile.ZipFile(ipa) as z: 
 ent = next((n for n in z.namelist() 
 if re.search(r'Payload/[^/]+\.app/Frameworks/Flutter\.framework/Flutter$', n)), None) 
 if ent is None: raise SystemExit("[-] no Flutter.framework in IPA") 
 dst = os.path.join(tempfile.mkdtemp(prefix="vc_"), "Flutter") 
 with z.open(ent) as s, open(dst, "wb") as f: f.write(s.read()) 
 return dst 

def main(): 
 ap = argparse.ArgumentParser(description="Dio validateCertificate pinning bypass (authorized testing only)") 
 ap.add_argument("input", help=".apk | .ipa | libflutter.so | Flutter binary") 
 ap.add_argument("--host", default="TARGET_HOST", help="server host, used in the PEM-fetch hint in the script") 
 ap.add_argument("-o", "--out", default="dio_validatecert_bypass.js", help="Frida script output path") 
 a = ap.parse_args() 

 kind = classify(a.input) 
 if kind == "apk": info = analyze_elf(extract_apk_arm64(a.input), "arm64-v8a") 
 elif kind == "ipa": info = analyze_macho(extract_ipa(a.input), "ios") 
 elif kind == "macho": info = analyze_macho(a.input) 
 else: info = analyze_elf(a.input) 
 if not info: raise SystemExit(1) 
 write_frida(info, a.host, a.out) 
 if not info["frees"] and info["arch"] == "arm64": 
 print("[!] no X509_free candidates found — the app may crash on free; inspect manually") 

if __name__ == "__main__": 
 main() 
