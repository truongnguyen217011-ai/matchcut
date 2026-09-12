# MatchCut portable

## May moi

1. Cai NVIDIA driver moi nhat neu may co GPU NVIDIA.
2. Cai Node.js 20+ va Python 3.10+.
3. Mo PowerShell trong thu muc nay va chay:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-portable.ps1
```

4. Chay tool:

```powershell
.\start-portable.ps1
```

Mo `http://localhost:4173` tren trinh duyet.

Fast Render mac dinh dung NVENC `p1`, CQ 23. Co the override khi benchmark:

```powershell
$env:MATCHCUT_NVENC_PRESET="p2"
$env:MATCHCUT_NVENC_CQ="25"
.\start-portable.ps1
```

Goi portable khong kem `node_modules`, virtualenv Whisper, cache, job va output cu; script cai dat se tai lai dung phien ban trong `package-lock.json`.

De co toc do gan may goc, may moi can GPU/driver NVENC, SSD, Node, Python va toc do doc footage tuong duong. Khong co NVIDIA CUDA, tool tu dong fallback CPU va se cham hon.
