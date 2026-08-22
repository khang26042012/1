---
name: extreme-router-code-audit
description: |
  Mandatory critical-thinking and code-audit protocol for ExtremeRouter. Use on EVERY task
  that writes, modifies, adds, refactors, or fixes bugs in the codebase — including
  Per-Key Model Access Control, Playground, Health Monitor, Circuit Breaker, API routes,
  routing/middleware logic, or database schema. Also trigger when the user asks to
  "audit kode", "review perubahan", "cek konflik", "kenapa error/bug ini", or "apakah aman diubah".
  This skill encodes the rules from the project's root skill.md so they are always applied.
---

# ExtremeRouter — Critical Thinking & Mandatory Code Audit

> **Konteks:** ExtremeRouter (alias 9Router) adalah self-hosted AI gateway, dibangun dari base
> 9Router sebagai starting point. Stack: Next.js 16, React 19, Node.js 20+, SQLite.
> Kode sudah tersedia di folder lokal — jangan cari/reference ke GitHub.

## Mode Berpikir yang Wajib Dipakai

1. **Jangan langsung nulis kode.** Pahami dulu requirement/masalahnya secara eksplisit — kalau ada
   bagian yang ambigu, tanya dulu sebelum eksekusi, terutama kalau perubahannya menyentuh auth,
   routing core, atau schema.
2. **Cari root cause, bukan gejala.** Kalau lagi fix bug, jangan tempel patch di titik error muncul
   kalau akar masalahnya ada di tempat lain.
3. **Pertimbangkan lebih dari satu pendekatan** sebelum memilih, terutama untuk perubahan yang
   menyentuh security/access-control — karena ini gateway yang mengatur akses ke model AI, kesalahan
   di sini bisa berarti key yang harusnya dibatasi malah bisa akses model lain.
4. **Jangan asumsikan kode existing pasti benar**, tapi juga jangan ubah kode di luar scope task
   tanpa alasan yang dijelaskan ke user.
5. **Untuk perubahan besar** (schema database, auth flow, routing inti, breaking change ke API
   publik) — jelaskan trade-off ke user dan minta konfirmasi sebelum eksekusi penuh.

## Fitur Paling Kritis: Per-Key Model Access Control

- Kontrol granular model AI mana yang boleh diakses tiap API key — ini TIDAK ada di base 9Router dan
  jadi core value project ini.
- Setiap perubahan yang menyentuh layer **routing, auth, atau middleware** WAJIB dicek: apakah aturan
  akses per-key masih dihormati? Adakah path baru yang berpotensi bypass access control (endpoint baru
  yang lupa dipasangi guard yang sama)?
- Fitur target lain (belum semua selesai): Playground, Health Monitor, Circuit Breaker.

## ATURAN WAJIB: Audit Setelah Setiap Perubahan Kode

Sebelum bilang "selesai" ke user, jalankan audit ini **setiap kali** selesai menulis, mengubah,
menambah, atau refactor kode. Ini bukan opsional, dan berlaku juga untuk bug fix sekecil apapun.

### 1. Self-review diff
- Baca ulang seluruh perubahan baris-per-baris seolah jadi reviewer lain yang skeptis terhadap kode
  sendiri.
- Cek: logic sudah sesuai requirement? Ada dead code, unused import/variable, atau sisa debugging
  (console.log dsb) yang ketinggalan?
- Cek konsistensi naming, style, dan pola yang sudah dipakai di file/module sekitar.

### 2. Cek konflik dengan kode yang sudah ada
- Sebelum menambah fungsi/route/komponen/tabel baru, search dulu apakah sudah ada yang punya tanggung
  jawab serupa — cegah duplikasi logic.
- **API routes (Next.js):** cek apakah ada route lain yang overlap path atau method-nya.
- **Schema SQLite:** cek migration yang sudah ada, foreign key, dan index yang mungkin bentrok atau
  perlu ikut di-update.
- **Shared module/util/type:** cari semua pemanggil (usages) dari kode yang diubah, pastikan tidak ada
  yang patah akibat perubahan signature/behavior.
- **Komponen React:** cek apakah ada state/props/context yang overlap, atau side-effect yang bisa
  saling tabrakan dengan komponen lain.

### 3. Verifikasi teknis — jalankan, jangan cuma dibaca
- Type-check (`tsc --noEmit` atau setara)
- Linter project
- Build (`next build`), minimal untuk area yang tersentuh kalau full build terlalu lama
- Test yang relevan, kalau ada
- Kalau ada step yang tidak bisa dijalankan (butuh env/secret yang tidak tersedia di sesi ini),
  sebutkan eksplisit ke user bahwa step itu di-skip dan alasannya — jangan diam-diam dilewati.

### 4. Cek dampak khusus ke Per-Key Model Access Control
- Periksa bahwa setiap perubahan yang menyentuh routing, auth, atau middleware tidak membuka celah
  bypass access control.

### 5. Laporkan hasil audit — jangan cuma bilang "sudah selesai"
- **Apa yang diubah/ditambah** — file & ringkasan singkat
- **Hasil audit** — lint/type-check/build/test: pass/fail, dan apa saja yang di-skip beserta alasan
- **Konflik yang ditemukan** (kalau ada) dan bagaimana diselesaikan
- **Risiko/edge case yang belum tercover** — jangan disembunyikan, biar user yang putuskan mau
  dikerjakan sekarang atau nanti

## Kalau Sedang Menyelesaikan Bug

1. Reproduce dulu atau pastikan paham exact failure-nya sebelum menyentuh kode.
2. Telusuri root cause lewat log/stack trace/data nyata — bukan trial-and-error tebak-tebakan.
3. Kalau fix-nya menyentuh banyak file atau logic inti (routing, auth, schema), jelaskan trade-off ke
   user dulu sebelum eksekusi.
4. Setelah fix, tetap jalankan seluruh checklist audit di atas — bug fix tetap termasuk "perubahan kode".

## Checklist Cepat (pakai di akhir setiap task)

- [ ] Diff sudah di-review ulang line-by-line
- [ ] Tidak ada duplikasi logic/fungsi/route/komponen yang sebenarnya sudah ada
- [ ] Type-check pass
- [ ] Lint pass
- [ ] Build pass (atau ada alasan jelas kenapa di-skip)
- [ ] Test relevan pass (atau ada alasan jelas kenapa di-skip)
- [ ] Dampak ke Per-Key Access Control sudah dicek (kalau relevan dengan perubahan ini)
- [ ] Semua pemanggil/usage dari kode yang diubah sudah dicek tidak patah
- [ ] Sudah lapor ringkasan + risiko ke user, bukan cuma "done"
