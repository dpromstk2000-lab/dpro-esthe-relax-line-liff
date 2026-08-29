from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from typing import Iterable

from PIL import Image
import qrcode
import fitz
import cv2
from playwright.sync_api import sync_playwright
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from reportlab.lib.colors import HexColor, white

BASE = "https://dpromstk2000-lab.github.io/dpro-esthe-relax-line-liff/"
TUTORIAL_URL = BASE + "tutorial-start.html"
GUIDE_URL = BASE + "guide-center.html"
OUT = Path("manuals")
SCREENS = OUT / "screens"
RENDERS = OUT / "renders"
QRDIR = OUT / "qr"

QUICK_PDF = OUT / "DPRO_TUTORIAL_ESTHE_QUICK_START_V1.0.pdf"
QUICK_PNG = OUT / "DPRO_TUTORIAL_ESTHE_QUICK_START_V1.0.png"
DETAIL_PDF = OUT / "DPRO_TUTORIAL_ESTHE_DETAILED_MANUAL_V1.0.pdf"

FIRST10 = [
    (1, "公開デモの入口", "demo-guide.html", "公開デモの全体像と、安全なデモ利用の前提を確認します。"),
    (2, "5画面の役割を確認", "demo-guide.html", "予約・会員・スタッフ・店舗iPad・オーナーPCのつながりを確認します。"),
    (3, "予約は5段階", "index-brush.html?v=esthe-next-10b", "会員確認から予約確認までの5段階を把握します。"),
    (4, "会員確認から開始", "index-brush.html?v=esthe-next-10b", "電話番号や名前による会員確認の入口を確認します。"),
    (5, "会員マイページ", "member.html", "次回予約・回数券・来店履歴の入口を確認します。"),
    (6, "履歴・回数券の入口", "member.html", "デモ表示・履歴・回数券の入口だけを確認します。"),
    (7, "管理コードはユーザー操作", "staff.html", "管理コードは利用者自身が既存画面で入力します。"),
    (8, "スタッフの「今やること」", "staff.html", "担当予約と次の1操作を優先するスタッフ画面を確認します。"),
    (9, "店舗iPadで施術進捗", "owner-ipad.html", "本日の来店と施術進捗の確認ポイントを把握します。"),
    (10, "オーナーPCで再来店フォロー", "owner.html", "再来店フォローにつながる管理画面の入口を確認します。"),
]

# ---------- filesystem ----------
for d in (OUT, SCREENS, RENDERS, QRDIR):
    d.mkdir(parents=True, exist_ok=True)

# ---------- font ----------
FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]
font_path = next((p for p in FONT_CANDIDATES if Path(p).exists()), None)
if not font_path:
    raise RuntimeError("Japanese font not found")
pdfmetrics.registerFont(TTFont("JP", font_path))

# ---------- helpers ----------
PAGE_W, PAGE_H = A4
M = 34
BROWN = HexColor("#7c4f44")
PALE = HexColor("#fbefe9")
INK = HexColor("#2d211f")
MUTED = HexColor("#6f5b55")
GREEN = HexColor("#0f8a6a")
BORDER = HexColor("#e4c9be")


def wrap_jp(text: str, max_chars: int) -> list[str]:
    text = str(text).replace("\n", " ").strip()
    if not text:
        return [""]
    lines, buf = [], ""
    for ch in text:
        buf += ch
        if len(buf) >= max_chars or ch in "。！？":
            lines.append(buf.strip())
            buf = ""
    if buf.strip():
        lines.append(buf.strip())
    return lines


def draw_text(c: canvas.Canvas, text: str, x: float, y: float, size: float = 10,
              max_chars: int = 38, leading: float | None = None, color=INK,
              font: str = "JP") -> float:
    leading = leading or size * 1.45
    c.setFont(font, size)
    c.setFillColor(color)
    for line in wrap_jp(text, max_chars):
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_header(c: canvas.Canvas, title: str, subtitle: str, page_no: int | None = None):
    c.setFillColor(PALE)
    c.rect(0, PAGE_H - 88, PAGE_W, 88, fill=1, stroke=0)
    c.setFillColor(BROWN)
    c.setFont("JP", 9)
    c.drawString(M, PAGE_H - 27, "DPRO TUTORIAL STANDARD V1.1 / ESTHE")
    c.setFillColor(INK)
    c.setFont("JP", 21)
    c.drawString(M, PAGE_H - 53, title)
    c.setFillColor(MUTED)
    c.setFont("JP", 8.7)
    c.drawString(M, PAGE_H - 70, subtitle)
    if page_no is not None:
        c.setFont("JP", 8)
        c.drawRightString(PAGE_W - M, PAGE_H - 27, f"P. {page_no}")


def draw_footer(c: canvas.Canvas, text: str = "実在するお客様情報・健康/カウンセリング情報・本番資格情報は掲載しません。"):
    c.setStrokeColor(BORDER)
    c.line(M, 27, PAGE_W - M, 27)
    c.setFillColor(MUTED)
    c.setFont("JP", 7.2)
    c.drawString(M, 16, text)


def add_image(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float):
    im = Image.open(path)
    iw, ih = im.size
    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    c.setFillColor(white)
    c.roundRect(x, y, w, h, 10, fill=1, stroke=0)
    c.drawImage(ImageReader(im), dx, dy, dw, dh, preserveAspectRatio=True, mask='auto')
    c.setStrokeColor(BORDER)
    c.roundRect(x, y, w, h, 10, fill=0, stroke=1)


def make_qr(url: str, out: Path):
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M,
                       box_size=10, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    qr.make_image(fill_color="black", back_color="white").save(out)


def draw_qr(c: canvas.Canvas, qr_path: Path, url: str, x: float, y: float, size: float = 94):
    c.drawImage(str(qr_path), x, y, size, size, preserveAspectRatio=True, mask='auto')
    c.setFont("JP", 6.8)
    c.setFillColor(MUTED)
    c.drawString(x, y - 11, "QRを読み取り、公開URLを開きます")
    c.setFont("JP", 5.5)
    c.drawString(x, y - 21, url)


def screenshot_clip(page, selector: str, path: Path, padding: int = 22):
    loc = page.locator(selector).first
    loc.wait_for(state="visible", timeout=15000)
    box = loc.bounding_box()
    if not box:
        raise RuntimeError(f"No bounding box for {selector}")
    vw = page.viewport_size["width"]
    vh = page.viewport_size["height"]
    x = max(0, box["x"] - padding)
    y = max(0, box["y"] - padding)
    r = min(vw, box["x"] + box["width"] + padding)
    b = min(vh, box["y"] + box["height"] + padding)
    if r - x < 40 or b - y < 30:
        raise RuntimeError(f"Unsafe/too-small clip for {selector}")
    page.screenshot(path=str(path), clip={"x": x, "y": y, "width": r-x, "height": b-y})


# ---------- LIVE screenshots ----------
network_writes: list[dict] = []
page_errors: list[str] = []
console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    page = context.new_page()
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda r: network_writes.append({"method": r.method, "url": r.url}) if r.method not in ("GET", "HEAD", "OPTIONS") else None)

    # Guide Center - known read-only static content.
    page.goto(GUIDE_URL, wait_until="domcontentloaded")
    page.wait_for_function("() => window.__DPRO_GUIDE_CENTER__?.total === 10")
    page.screenshot(path=str(SCREENS / "01_guide_center.png"), full_page=False)

    # Tutorial STEP 1 - clean Tutorial-only state, no business interaction.
    page.evaluate("localStorage.removeItem('dpro_tutorial_esthe_first10_v1_1')")
    page.goto(TUTORIAL_URL + "?auto=1", wait_until="domcontentloaded")
    page.wait_for_url(re.compile(r"demo-guide\.html.*dpro_tutorial=1"), timeout=15000)
    page.wait_for_function("() => window.__DPRO_TUTORIAL__?.total === 10")
    page.locator("#dproTutorialLauncher").click()
    page.wait_for_selector("#dproTutorialCard:not([hidden])")
    page.screenshot(path=str(SCREENS / "02_tutorial_step1.png"), full_page=False)

    # Safe, tightly-cropped LIVE UI evidence. We deliberately avoid result/customer lists.
    page.goto(BASE + "index-brush.html?v=esthe-next-10b", wait_until="domcontentloaded")
    screenshot_clip(page, ".progress", SCREENS / "03_booking_progress.png", 28)
    # Explicitly verify public-entry fields are blank before screenshotting their region.
    page.goto(BASE + "member.html", wait_until="domcontentloaded")
    if page.locator("#phoneInput").input_value() != "":
        raise RuntimeError("member phone field unexpectedly non-empty")
    screenshot_clip(page, "#phoneInput", SCREENS / "04_member_entry.png", 38)

    page.goto(BASE + "staff.html", wait_until="domcontentloaded")
    if page.locator("#dproAdminCode").count() and page.locator("#dproAdminCode").input_value() != "":
        raise RuntimeError("staff admin code unexpectedly non-empty")
    screenshot_clip(page, "#dproAdminAccess", SCREENS / "05_staff_access.png", 24)

    page.goto(BASE + "owner-ipad.html", wait_until="domcontentloaded")
    screenshot_clip(page, "#progressBoardTitle", SCREENS / "06_owner_ipad_title.png", 38)

    page.goto(BASE + "owner.html", wait_until="domcontentloaded")
    screenshot_clip(page, '[data-tab="followups"]', SCREENS / "07_owner_followups_tab.png", 38)

    context.close()
    browser.close()

if page_errors:
    raise RuntimeError("LIVE pageerror: " + " | ".join(page_errors))
if network_writes:
    raise RuntimeError("Unexpected business write during screenshot capture: " + json.dumps(network_writes, ensure_ascii=False))

# ---------- QR assets ----------
QR_TUT = QRDIR / "tutorial-start.png"
QR_GUIDE = QRDIR / "guide-center.png"
make_qr(TUTORIAL_URL, QR_TUT)
make_qr(GUIDE_URL, QR_GUIDE)

# ---------- Quick Start PDF (1 page) ----------
c = canvas.Canvas(str(QUICK_PDF), pagesize=A4)
draw_header(c, "DPRO ESTHE かんたんスタート", "First10 exactly 10 / 現行Guide Center基準 / 2026-08-29", 1)
y = PAGE_H - 116
c.setFillColor(INK); c.setFont("JP", 13); c.drawString(M, y, "最初にやること")
y -= 21
y = draw_text(c, "1. QRまたはGuide CenterからTutorialを開く。 2. StartでSTEP 1から開始。 3. 閉じた後はResumeで続きから再開。 4. 完了後はReplayで最初から復習できます。", M, y, 9.2, 46, 14)

# QR block on right, screenshot below.
draw_qr(c, QR_TUT, TUTORIAL_URL, PAGE_W - M - 104, PAGE_H - 255, 96)

c.setFillColor(BROWN); c.setFont("JP", 11); c.drawString(M, PAGE_H - 220, "操作の基本")
draw_text(c, "・Next / Backで進む・戻る。 ・右上の閉じる、またはEscで一時停止。 ・カードは専用ハンドルだけでドラッグ可能。 ・Tab / Enterだけでも完了できます。", M, PAGE_H - 239, 8.5, 33, 13)

add_image(c, SCREENS / "01_guide_center.png", M, 227, PAGE_W - 2*M, 250)

c.setFillColor(PALE); c.roundRect(M, 75, PAGE_W - 2*M, 128, 12, fill=1, stroke=0)
c.setFillColor(BROWN); c.setFont("JP", 11); c.drawString(M+14, 181, "安全ルール")
draw_text(c, "Tutorialは予約送信、会員照会、施術状態変更、回数券使用、カルテ保存、フォロー送信を自動実行しません。公開デモでは実在する氏名・電話番号・健康/カウンセリング情報・本番資格情報を入力しないでください。", M+14, 161, 8.5, 58, 13)
draw_text(c, "Guide Center: " + GUIDE_URL, M+14, 103, 7.1, 75, 10, MUTED)
draw_footer(c)
c.showPage(); c.save()

# ---------- Detailed Manual PDF (6 pages) ----------
c = canvas.Canvas(str(DETAIL_PDF), pagesize=A4)

# P1 Overview
draw_header(c, "DPRO ESTHE 導入・操作マニュアル", "First10 / Guide Center / 安全な公開デモ運用", 1)
add_image(c, SCREENS / "01_guide_center.png", M, 408, PAGE_W - 2*M, 300)
c.setFillColor(BROWN); c.setFont("JP", 12); c.drawString(M, 382, "このマニュアルの基準")
draw_text(c, "R4 CENTRAL ACCEPT済みのGuide Centerと、R3 LIVE QA PASS済みのFirst10 exactly 10を正本にしています。Tutorialの操作だけでは業務データを書き換えません。", M, 362, 8.8, 59, 13)
draw_qr(c, QR_TUT, TUTORIAL_URL, M, 170, 92)
draw_qr(c, QR_GUIDE, GUIDE_URL, M+155, 170, 92)
draw_text(c, "Tutorial Start", M, 151, 8.3, 18, 11)
draw_text(c, "Guide Center", M+155, 151, 8.3, 18, 11)
draw_text(c, "Start: STEP 1から開始 / Resume: 保存されたSTEPから再開 / Replay: 状態をリセットしてSTEP 1から再体験。進捗保存はTutorial専用localStorageのみです。", M+310, 250, 8.4, 28, 12)
draw_footer(c); c.showPage()

# P2 Steps 1-2
draw_header(c, "First10 STEP 1-2", "公開デモの入口 / 5画面の役割", 2)
add_image(c, SCREENS / "02_tutorial_step1.png", M, 408, PAGE_W - 2*M, 300)
y = 382
for no,title,route,desc in FIRST10[:2]:
    c.setFillColor(BROWN); c.setFont("JP", 11); c.drawString(M, y, f"STEP {no}  {title}")
    y = draw_text(c, desc, M+12, y-18, 8.7, 60, 12)
    draw_text(c, "安全: 製品カードや業務ボタンを自動クリックせず、案内とハイライトだけを行います。", M+12, y-2, 7.8, 66, 11, MUTED)
    y -= 48
c.setFillColor(PALE); c.roundRect(M, 100, PAGE_W-2*M, 110, 10, fill=1, stroke=0)
draw_text(c, "5画面は「予約 → 会員 → スタッフ → 店舗iPad → オーナーPC」の順で確認します。First10が画面をまたぐときはTutorial状態を保存し、次のページで同じSTEP番号から継続します。", M+14, 184, 8.6, 60, 13)
draw_footer(c); c.showPage()

# P3 Steps 3-4
draw_header(c, "First10 STEP 3-4", "予約: 5段階 / 会員確認", 3)
add_image(c, SCREENS / "03_booking_progress.png", M, 458, PAGE_W - 2*M, 235)
y = 426
for no,title,route,desc in FIRST10[2:4]:
    c.setFillColor(BROWN); c.setFont("JP", 11); c.drawString(M, y, f"STEP {no}  {title}")
    y = draw_text(c, desc, M+12, y-18, 8.7, 60, 12)
    y -= 35
c.setFillColor(PALE); c.roundRect(M, 145, PAGE_W-2*M, 130, 10, fill=1, stroke=0)
draw_text(c, "ここでは予約を完了させません。#nextBtn / #submitBtn をTutorialが押すことはなく、電話番号・氏名などの実在情報も自動入力しません。画面の構成と会員確認の入口だけを把握します。", M+14, 250, 8.7, 59, 13)
draw_footer(c); c.showPage()

# P4 Steps 5-6
draw_header(c, "First10 STEP 5-6", "会員マイページ / 履歴・回数券の入口", 4)
add_image(c, SCREENS / "04_member_entry.png", M, 470, PAGE_W - 2*M, 220)
y = 438
for no,title,route,desc in FIRST10[4:6]:
    c.setFillColor(BROWN); c.setFont("JP", 11); c.drawString(M, y, f"STEP {no}  {title}")
    y = draw_text(c, desc, M+12, y-18, 8.7, 60, 12)
    y -= 35
c.setFillColor(PALE); c.roundRect(M, 150, PAGE_W-2*M, 120, 10, fill=1, stroke=0)
draw_text(c, "電話番号入力、読み込み、デモ顧客ボタン、予約変更・キャンセル・再予約などはユーザー操作です。Tutorialは入口をハイライトするだけで、自動実行しません。", M+14, 244, 8.7, 59, 13)
draw_footer(c); c.showPage()

# P5 Steps 7-8
draw_header(c, "First10 STEP 7-8", "スタッフ: 管理コード / 今やること", 5)
add_image(c, SCREENS / "05_staff_access.png", M, 470, PAGE_W - 2*M, 220)
y = 438
for no,title,route,desc in FIRST10[6:8]:
    c.setFillColor(BROWN); c.setFont("JP", 11); c.drawString(M, y, f"STEP {no}  {title}")
    y = draw_text(c, desc, M+12, y-18, 8.7, 60, 12)
    y -= 35
c.setFillColor(PALE); c.roundRect(M, 140, PAGE_W-2*M, 132, 10, fill=1, stroke=0)
draw_text(c, "管理コードはTutorialが推測・注入・保存しません。施術開始や状態変更も行いません。既存スタッフ画面で利用者が明示的に操作する場合だけ業務処理が発生します。", M+14, 245, 8.7, 59, 13)
draw_footer(c); c.showPage()

# P6 Steps 9-10 + resume/troubleshooting
draw_header(c, "First10 STEP 9-10 / 再開・復習", "店舗iPad / オーナーPC / Resume / Replay", 6)
add_image(c, SCREENS / "06_owner_ipad_title.png", M, 520, (PAGE_W-2*M-12)/2, 150)
add_image(c, SCREENS / "07_owner_followups_tab.png", M+(PAGE_W-2*M-12)/2+12, 520, (PAGE_W-2*M-12)/2, 150)
y = 495
for no,title,route,desc in FIRST10[8:10]:
    c.setFillColor(BROWN); c.setFont("JP", 10.5); c.drawString(M, y, f"STEP {no}  {title}")
    y = draw_text(c, desc, M+12, y-17, 8.4, 61, 12)
    y -= 24
c.setFillColor(BROWN); c.setFont("JP", 11); c.drawString(M, y, "中断・再開・キーボード")
y = draw_text(c, "Escまたは閉じるで一時停止し、Guide CenterのResumeから保存されたSTEPへ戻れます。Tabでフォーカス移動、Enterで操作できます。ドラッグは任意で、専用ハンドルだけが移動操作を受け付けます。", M+12, y-18, 8.4, 60, 12)
y -= 18
c.setFillColor(BROWN); c.setFont("JP", 11); c.drawString(M, y, "トラブル時")
y = draw_text(c, "対象が見つからない場合はFirst10のフォールバック対象を使います。画面外へカードが移動してもviewport clampで戻せます。状態がおかしい場合はGuide CenterからReplayを選ぶとSTEP 1へ戻ります。", M+12, y-18, 8.4, 60, 12)
draw_footer(c); c.showPage(); c.save()

# ---------- Render every PDF page ----------
def render_pdf(pdf: Path, prefix: str, dpi: int = 180) -> list[Path]:
    doc = fitz.open(pdf)
    paths = []
    scale = dpi / 72.0
    mat = fitz.Matrix(scale, scale)
    for idx, page in enumerate(doc):
        pix = page.get_pixmap(matrix=mat, alpha=False)
        out = RENDERS / f"{prefix}_PAGE_{idx+1:02d}.png"
        pix.save(out)
        paths.append(out)
    return paths

quick_renders = render_pdf(QUICK_PDF, "QUICK")
detail_renders = render_pdf(DETAIL_PDF, "DETAILED")
shutil.copy2(quick_renders[0], QUICK_PNG)
for i,p in enumerate(detail_renders, 1):
    shutil.copy2(p, OUT / f"DPRO_TUTORIAL_ESTHE_DETAILED_MANUAL_V1.0_PAGE_{i:02d}.png")

# ---------- Automated render sanity ----------
visual = {"version":"R5-V1.0","human_visual_review":"PENDING_ASSISTANT_ARTIFACT_REVIEW","pages":[],"pass_automated":True,"failures":[]}
for pdf_name, render_paths in [(QUICK_PDF.name, quick_renders), (DETAIL_PDF.name, detail_renders)]:
    for i,p in enumerate(render_paths,1):
        im = Image.open(p).convert("L")
        arr = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        nonwhite = float((arr < 248).mean())
        ok = im.width > 1000 and im.height > 1400 and nonwhite > 0.015
        item={"pdf":pdf_name,"page":i,"render":str(p),"width":im.width,"height":im.height,"nonwhite_ratio":nonwhite,"automated_pass":ok}
        visual["pages"].append(item)
        if not ok:
            visual["pass_automated"] = False
            visual["failures"].append(item)
(OUT / "R5_PDF_VISUAL_QA.json").write_text(json.dumps(visual, ensure_ascii=False, indent=2), encoding="utf-8")
if not visual["pass_automated"]:
    raise RuntimeError("Automated PDF render sanity failed")

# ---------- Decode every QR from rendered PDF output ----------
expected = {
    QUICK_PDF.name: [TUTORIAL_URL],
    DETAIL_PDF.name: [TUTORIAL_URL, GUIDE_URL],
}
qr_report={"version":"R5-V1.0","pdfs":[],"pass":True,"failures":[]}
for pdf_name, render_paths in [(QUICK_PDF.name, quick_renders), (DETAIL_PDF.name, detail_renders)]:
    decoded=[]
    for p in render_paths:
        img=cv2.imread(str(p))
        detector=cv2.QRCodeDetector()
        try:
            retval, infos, points, _ = detector.detectAndDecodeMulti(img)
            if retval:
                decoded.extend([s for s in infos if s])
            else:
                s, pts, _ = detector.detectAndDecode(img)
                if s: decoded.append(s)
        except Exception:
            s, pts, _ = detector.detectAndDecode(img)
            if s: decoded.append(s)
    unique=[]
    for s in decoded:
        if s not in unique: unique.append(s)
    exp=expected[pdf_name]
    ok=all(u in unique for u in exp)
    item={"pdf":pdf_name,"expected":exp,"decoded":unique,"pass":ok}
    qr_report["pdfs"].append(item)
    if not ok:
        qr_report["pass"]=False
        qr_report["failures"].append(item)
(OUT / "R5_QR_QA.json").write_text(json.dumps(qr_report, ensure_ascii=False, indent=2), encoding="utf-8")
if not qr_report["pass"]:
    raise RuntimeError("QR decode QA failed: " + json.dumps(qr_report, ensure_ascii=False))

# ---------- Final report ----------
report = {
    "version":"R5-V1.0",
    "industry":"ESTHE",
    "base":BASE,
    "first10_count":len(FIRST10),
    "quick_pages":len(quick_renders),
    "detailed_pages":len(detail_renders),
    "screenshots":[p.name for p in sorted(SCREENS.glob("*.png"))],
    "pageerrors":page_errors,
    "consoleErrors":console_errors,
    "unsafeWrites":network_writes,
    "businessMutation":0,
    "qrPass":qr_report["pass"],
    "automatedRenderPass":visual["pass_automated"],
    "humanVisualReview":"PENDING_ASSISTANT_ARTIFACT_REVIEW",
}
(OUT / "R5_BUILD_REPORT.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
