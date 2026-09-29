/**
 * controllers/reportsController.js
 * PDF performance report (pdfkit) + shareable trade-card SVG/PNG.
 */

'use strict';

const PDFDocument = require('pdfkit');
const Trade       = require('../models/Trade');
const User        = require('../models/User');
const { sendError } = require('../utils/response');

// ── Brand colours ─────────────────────────────────────────────────────────────
const BRAND_INDIGO = '#5B6CFF';
const BRAND_CYAN   = '#22D3EE';
const GAIN_COLOR   = '#22C55E';
const LOSS_COLOR   = '#EF4444';
const BG_DARK      = '#0B1220';
const SURFACE      = '#111A2E';
const BORDER       = '#1E2A44';
const TEXT_LIGHT   = '#E6EBF5';
const TEXT_MUTED   = '#8A97B2';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n, digits = 2) {
  if (n == null) return '—';
  return n.toFixed(digits);
}

function fmtPnL(n, currency = 'USD') {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  try {
    return sign + new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2,
    }).format(Math.abs(n));
  } catch {
    return `${sign}${Math.abs(n).toFixed(2)}`;
  }
}

function computeStats(trades) {
  const closed = trades.filter(t => t.status === 'closed' && t.pnl != null);
  const winners = closed.filter(t => t.pnl > 0);
  const losers  = closed.filter(t => t.pnl <= 0);

  const totalPnL    = closed.reduce((s, t) => s + t.pnl, 0);
  const winRate     = closed.length > 0 ? winners.length / closed.length : 0;
  const avgWin      = winners.length > 0 ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
  const avgLoss     = losers.length  > 0 ? Math.abs(losers.reduce((s, t) => s + t.pnl, 0) / losers.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * winners.length) / (avgLoss * losers.length) : null;

  // Max drawdown (running)
  let peak = 0, equity = 0, maxDD = 0;
  for (const t of closed.sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate))) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    totalTrades: closed.length,
    winRate,
    profitFactor,
    totalPnL,
    avgWin,
    avgLoss,
    maxDrawdown: maxDD,
    winCount: winners.length,
    lossCount: losers.length,
  };
}

// ── PDF Report ─────────────────────────────────────────────────────────────────

exports.generatePdf = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { from, to } = req.query;

    const user = await User.findById(userId);
    if (!user) return sendError(res, 404, 'User not found.', 'NOT_FOUND');

    // Build date filter
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to)   dateFilter.$lte = new Date(to + 'T23:59:59Z');

    const query = { userId };
    if (from || to) query.entryDate = dateFilter;

    const trades = await Trade.find(query).sort({ entryDate: 1 }).lean();
    const stats  = computeStats(trades);
    const currency = user.baseCurrency || 'USD';

    // ── Build PDF ─────────────────────────────────────────────────────────────
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: 'Tradiary Performance Report',
        Author: user.name,
        Creator: 'Tradiary — tradiary.app',
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="tradiary-report-${new Date().toISOString().slice(0, 10)}.pdf"`);
    doc.pipe(res);

    const W = 595 - 100; // A4 width minus margins
    let y = 50;

    // ── Cover / Header ─────────────────────────────────────────────────────────
    // Gradient bar (simulated with two rects)
    doc.rect(50, y, W * 0.5, 6).fill(BRAND_INDIGO);
    doc.rect(50 + W * 0.5, y, W * 0.5, 6).fill(BRAND_CYAN);
    y += 20;

    doc.fontSize(22).font('Helvetica-Bold').fillColor(BG_DARK).text('Tradiary', 50, y);
    y += 28;
    doc.fontSize(11).font('Helvetica').fillColor(TEXT_MUTED).text('Performance Report', 50, y);
    y += 14;

    const rangeStr = from || to
      ? `${from || 'All time'} → ${to || 'now'}`
      : 'All time';
    doc.fontSize(9).fillColor(TEXT_MUTED).text(`Period: ${rangeStr}  |  Generated: ${new Date().toLocaleDateString()}  |  Trader: ${user.name}`, 50, y);
    y += 30;

    // ── Summary Metrics ────────────────────────────────────────────────────────
    doc.rect(50, y, W, 1).fill(BORDER);
    y += 12;
    doc.fontSize(13).font('Helvetica-Bold').fillColor(BG_DARK).text('Summary', 50, y);
    y += 20;

    const metrics = [
      ['Total Trades',   stats.totalTrades.toString()],
      ['Win Rate',       `${(stats.winRate * 100).toFixed(1)}%`],
      ['Profit Factor',  stats.profitFactor != null ? fmt(stats.profitFactor) : '—'],
      ['Net P&L',        fmtPnL(stats.totalPnL, currency)],
      ['Avg Win',        fmtPnL(stats.avgWin, currency)],
      ['Avg Loss',       fmtPnL(-stats.avgLoss, currency)],
      ['Max Drawdown',   `${(stats.maxDrawdown * 100).toFixed(1)}%`],
      ['Winners',        stats.winCount.toString()],
      ['Losers',         stats.lossCount.toString()],
    ];

    const colW = W / 3;
    metrics.forEach(([label, value], i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const mx  = 50 + col * colW;
      const my  = y + row * 44;

      doc.rect(mx, my, colW - 8, 38).fillAndStroke('#F8FAFC', BORDER);
      doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED).text(label, mx + 8, my + 6, { width: colW - 24 });
      const isGain = value.startsWith('+') && !label.includes('Drawdown');
      const isLoss = value.startsWith('-') || label === 'Max Drawdown';
      const valColor = isGain ? GAIN_COLOR : isLoss ? LOSS_COLOR : BG_DARK;
      doc.fontSize(13).font('Helvetica-Bold').fillColor(valColor).text(value, mx + 8, my + 16, { width: colW - 24 });
    });

    y += Math.ceil(metrics.length / 3) * 44 + 20;

    // ── Equity Curve (simple line chart) ──────────────────────────────────────
    if (stats.totalTrades > 1) {
      doc.rect(50, y, W, 1).fill(BORDER);
      y += 12;
      doc.fontSize(13).font('Helvetica-Bold').fillColor(BG_DARK).text('Equity Curve', 50, y);
      y += 18;

      const closed = trades.filter(t => t.status === 'closed' && t.pnl != null)
                           .sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate));

      const chartH = 100;
      const chartW = W;
      let cumPnl = 0;
      const points = closed.map(t => { cumPnl += t.pnl; return cumPnl; });
      const minP = Math.min(0, ...points);
      const maxP = Math.max(...points);
      const rangeP = maxP - minP || 1;

      const toX = (i) => 50 + (i / (points.length - 1)) * chartW;
      const toY = (v) => y + chartH - ((v - minP) / rangeP) * chartH;

      // zero line
      const zeroY = toY(0);
      doc.moveTo(50, zeroY).lineTo(50 + chartW, zeroY)
         .strokeColor(BORDER).lineWidth(0.5).stroke();

      // Equity line
      doc.moveTo(toX(0), toY(points[0]));
      for (let i = 1; i < points.length; i++) {
        doc.lineTo(toX(i), toY(points[i]));
      }
      const finalColor = cumPnl >= 0 ? GAIN_COLOR : LOSS_COLOR;
      doc.strokeColor(finalColor).lineWidth(1.5).stroke();

      y += chartH + 20;
    }

    // ── Trades Table ──────────────────────────────────────────────────────────
    const closedTrades = trades.filter(t => t.status === 'closed')
                               .sort((a, b) => new Date(b.entryDate) - new Date(a.entryDate))
                               .slice(0, 30); // cap at 30 rows

    if (closedTrades.length > 0) {
      doc.rect(50, y, W, 1).fill(BORDER);
      y += 12;
      doc.fontSize(13).font('Helvetica-Bold').fillColor(BG_DARK).text('Recent Trades (last 30)', 50, y);
      y += 18;

      const cols = [
        { label: 'Symbol', width: 60 },
        { label: 'Dir',    width: 40 },
        { label: 'Entry',  width: 70 },
        { label: 'Exit',   width: 70 },
        { label: 'P&L',    width: 80 },
        { label: 'R',      width: 50 },
        { label: 'Date',   width: 70 },
      ];

      // Header row
      doc.rect(50, y, W, 18).fill('#F1F5F9');
      let hx = 50;
      cols.forEach(c => {
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(TEXT_MUTED).text(c.label, hx + 4, y + 5, { width: c.width - 8 });
        hx += c.width;
      });
      y += 18;

      closedTrades.forEach((t, idx) => {
        if (y > 780) {
          doc.addPage();
          y = 50;
        }

        if (idx % 2 === 1) doc.rect(50, y, W, 16).fill('#F8FAFC');

        const pnlColor = t.pnl >= 0 ? GAIN_COLOR : LOSS_COLOR;
        const cells = [
          { text: t.symbol,                       color: BG_DARK, bold: true },
          { text: t.direction?.toUpperCase(),      color: TEXT_MUTED },
          { text: fmt(t.entryPrice),               color: TEXT_MUTED },
          { text: fmt(t.exitPrice),                color: TEXT_MUTED },
          { text: fmtPnL(t.pnl, currency),         color: pnlColor, bold: true },
          { text: t.rMultiple != null ? `${t.rMultiple > 0 ? '+' : ''}${fmt(t.rMultiple)}R` : '—', color: pnlColor },
          { text: new Date(t.entryDate).toLocaleDateString(), color: TEXT_MUTED },
        ];

        let cx = 50;
        cells.forEach((cell, ci) => {
          const col = cols[ci];
          doc.fontSize(7.5)
             .font(cell.bold ? 'Helvetica-Bold' : 'Helvetica')
             .fillColor(cell.color)
             .text(cell.text || '—', cx + 4, y + 4, { width: col.width - 8, ellipsis: true });
          cx += col.width;
        });
        y += 16;
      });
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    doc.fontSize(7).font('Helvetica').fillColor(TEXT_MUTED)
       .text('Not financial advice — for journaling and educational purposes only. tradiary.app', 50, 790, { align: 'center', width: W });

    doc.end();
  } catch (err) {
    next(err);
  }
};

// ── Trade Card (SVG → inline response) ───────────────────────────────────────

exports.generateTradeCard = async (req, res, next) => {
  try {
    const trade = await Trade.findOne({
      _id: req.params.tradeId,
      userId: req.user.id,
    }).lean();

    if (!trade) return sendError(res, 404, 'Trade not found.', 'NOT_FOUND');

    const user     = await User.findById(req.user.id).lean();
    const currency = user?.baseCurrency || 'USD';
    const pnl      = trade.pnl;
    const isGain   = pnl != null && pnl >= 0;
    const pnlColor = isGain ? GAIN_COLOR : LOSS_COLOR;
    const rStr     = trade.rMultiple != null
      ? `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R`
      : '';
    const pnlStr   = pnl != null ? fmtPnL(pnl, currency) : 'Open';
    const date     = trade.entryDate
      ? new Date(trade.entryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';

    const dirBg = trade.direction === 'long' ? '#1E2A44' : '#1E2A44';
    const dirFg = trade.direction === 'long' ? BRAND_INDIGO : TEXT_MUTED;

    // Card: 600×315 (ideal for Twitter card preview)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="315" viewBox="0 0 600 315">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B1220"/>
      <stop offset="1" stop-color="#0f1c35"/>
    </linearGradient>
    <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND_INDIGO}"/>
      <stop offset="1" stop-color="${BRAND_CYAN}"/>
    </linearGradient>
    <linearGradient id="pnlGlow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${pnlColor}" stop-opacity="0.15"/>
      <stop offset="1" stop-color="${pnlColor}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="round"><rect width="600" height="315" rx="16"/></clipPath>
  </defs>

  <!-- Background -->
  <rect width="600" height="315" rx="16" fill="url(#bg)"/>

  <!-- Subtle grid -->
  ${Array.from({ length: 16 }, (_, i) => `<line x1="${i*40}" y1="0" x2="${i*40}" y2="315" stroke="#16213A" stroke-width="1"/>`).join('')}
  ${Array.from({ length: 9 },  (_, i) => `<line x1="0" y1="${i*40}" x2="600" y2="${i*40}" stroke="#16213A" stroke-width="1"/>`).join('')}

  <!-- P&L glow sweep -->
  <rect x="0" y="160" width="600" height="155" fill="url(#pnlGlow)"/>

  <!-- Border -->
  <rect width="600" height="315" rx="16" fill="none" stroke="${BORDER}" stroke-width="1.5"/>

  <!-- Top: Logo watermark -->
  <!-- Icon: rounded rect + T shape -->
  <rect x="24" y="22" width="28" height="28" rx="7" fill="url(#logoGrad)"/>
  <rect x="30" y="28" width="16" height="4" rx="2" fill="white"/>
  <rect x="36" y="30" width="4" height="11" rx="1.5" fill="white"/>
  <line x1="38" y1="41" x2="38" y2="45" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
  <!-- Wordmark -->
  <text x="58" y="40" font-family="Helvetica, sans-serif" font-size="15" font-weight="700" fill="${TEXT_LIGHT}" letter-spacing="-0.3">Tra</text>
  <text x="84" y="40" font-family="Helvetica, sans-serif" font-size="15" font-weight="700" fill="${BRAND_CYAN}" letter-spacing="-0.3">diary</text>

  <!-- Date + watermark right -->
  <text x="576" y="38" font-family="Helvetica, sans-serif" font-size="10" fill="${TEXT_MUTED}" text-anchor="end">${date}</text>

  <!-- Symbol + Direction -->
  <text x="24" y="105" font-family="Helvetica, sans-serif" font-size="38" font-weight="700" fill="${TEXT_LIGHT}">${trade.symbol}</text>
  <rect x="24" y="114" width="${trade.direction === 'long' ? 44 : 50}" height="20" rx="10" fill="${dirBg}"/>
  <text x="${trade.direction === 'long' ? 46 : 49}" y="128" font-family="Helvetica, sans-serif" font-size="11" font-weight="700" fill="${dirFg}" text-anchor="middle">${trade.direction?.toUpperCase()}</text>

  <!-- P&L -->
  <text x="24" y="185" font-family="Helvetica, sans-serif" font-size="52" font-weight="700" fill="${pnlColor}">${pnlStr}</text>

  <!-- R-multiple badge -->
  ${rStr ? `<rect x="24" y="196" width="64" height="24" rx="12" fill="${pnlColor}" fill-opacity="0.15"/>
  <text x="56" y="212" font-family="Helvetica, sans-serif" font-size="13" font-weight="700" fill="${pnlColor}" text-anchor="middle">${rStr}</text>` : ''}

  <!-- Entry / Exit pills -->
  <rect x="24" y="236" width="170" height="48" rx="10" fill="#16213A" stroke="${BORDER}" stroke-width="1"/>
  <text x="36" y="254" font-family="Helvetica, sans-serif" font-size="9" fill="${TEXT_MUTED}">ENTRY</text>
  <text x="36" y="272" font-family="Helvetica, sans-serif" font-size="14" font-weight="700" fill="${TEXT_LIGHT}">${trade.entryPrice?.toFixed(2) ?? '—'}</text>

  <rect x="206" y="236" width="170" height="48" rx="10" fill="#16213A" stroke="${BORDER}" stroke-width="1"/>
  <text x="218" y="254" font-family="Helvetica, sans-serif" font-size="9" fill="${TEXT_MUTED}">EXIT</text>
  <text x="218" y="272" font-family="Helvetica, sans-serif" font-size="14" font-weight="700" fill="${TEXT_LIGHT}">${trade.exitPrice?.toFixed(2) ?? '—'}</text>

  <!-- QTY pill -->
  <rect x="388" y="236" width="188" height="48" rx="10" fill="#16213A" stroke="${BORDER}" stroke-width="1"/>
  <text x="400" y="254" font-family="Helvetica, sans-serif" font-size="9" fill="${TEXT_MUTED}">QUANTITY</text>
  <text x="400" y="272" font-family="Helvetica, sans-serif" font-size="14" font-weight="700" fill="${TEXT_LIGHT}">${trade.quantity ?? '—'}</text>

  <!-- Footer -->
  <text x="300" y="302" font-family="Helvetica, sans-serif" font-size="9" fill="${TEXT_MUTED}" text-anchor="middle">tradiary.app — Not financial advice</text>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(svg);
  } catch (err) {
    next(err);
  }
};
