/**
 * MiniChart.js - Lightweight canvas-based charts (no external dependencies)
 * Supports: Line charts and Bar charts
 */

'use strict';

class MiniChart {
  constructor(canvas, type, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.type = type; // 'line' | 'bar'
    this.options = {
      padding: 30,
      gridLines: 5,
      animated: true,
      ...options,
    };
    this.data = { labels: [], datasets: [] };
    this._raf = null;
  }

  setData(data) {
    this.data = data;
    this.render();
  }

  update() {
    this.render();
  }

  render() {
    const { canvas, ctx, data, options } = this;
    const w = canvas.width = canvas.offsetWidth || 400;
    const h = canvas.height = canvas.offsetHeight || 180;
    const p = options.padding;

    ctx.clearRect(0, 0, w, h);

    if (!data.datasets || data.datasets.length === 0) return;

    if (this.type === 'line') this._renderLine(ctx, data, w, h, p);
    else if (this.type === 'bar') this._renderBar(ctx, data, w, h, p);
  }

  _renderLine(ctx, data, w, h, p) {
    const chartW = w - p * 1.5;
    const chartH = h - p * 1.2;

    // Find global max across all datasets
    let maxVal = 100;
    for (const ds of data.datasets) {
      const m = Math.max(...(ds.data || [0]));
      if (m > maxVal) maxVal = m;
    }

    // Draw grid
    ctx.strokeStyle = 'rgba(48,54,61,0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.options.gridLines; i++) {
      const y = p + (chartH * i) / this.options.gridLines;
      ctx.beginPath();
      ctx.moveTo(p, y);
      ctx.lineTo(w - p * 0.5, y);
      ctx.stroke();

      // Y labels
      const val = Math.round(maxVal - (maxVal * i) / this.options.gridLines);
      ctx.fillStyle = '#484f58';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val, p - 4, y + 3);
    }

    // Draw datasets
    for (const ds of data.datasets) {
      if (!ds.data || ds.data.length === 0) continue;
      const pts = ds.data;
      const n = pts.length;

      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = p + (chartW * i) / Math.max(n - 1, 1);
        const y = p + chartH - (pts[i] / maxVal) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      // Fill area
      if (ds.backgroundColor) {
        ctx.save();
        ctx.lineTo(p + chartW, p + chartH);
        ctx.lineTo(p, p + chartH);
        ctx.closePath();
        ctx.fillStyle = ds.backgroundColor || 'rgba(88,166,255,0.1)';
        ctx.fill();
        ctx.restore();
      }

      // Stroke line
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = p + (chartW * i) / Math.max(n - 1, 1);
        const y = p + chartH - (pts[i] / maxVal) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = ds.borderColor || '#58a6ff';
      ctx.lineWidth = ds.borderWidth || 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // Legend
    this._drawLegend(ctx, data.datasets, w, h);
  }

  _renderBar(ctx, data, w, h, p) {
    const chartW = w - p * 1.5;
    const chartH = h - p * 1.8;
    const labels = data.labels || [];
    const n = labels.length;
    const nDs = data.datasets.length;
    if (n === 0 || nDs === 0) return;

    let maxVal = 1;
    for (const ds of data.datasets) {
      const m = Math.max(...(ds.data || [0]));
      if (m > maxVal) maxVal = m;
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(48,54,61,0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = p + (chartH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(p, y);
      ctx.lineTo(w - p * 0.5, y);
      ctx.stroke();
      const val = Math.round(maxVal - (maxVal * i) / 4);
      ctx.fillStyle = '#484f58';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val, p - 4, y + 3);
    }

    const groupW = chartW / n;
    const barW = Math.min((groupW * 0.8) / nDs, 20);
    const groupGap = (groupW - barW * nDs) / 2;

    for (let gi = 0; gi < n; gi++) {
      // Label
      ctx.fillStyle = '#8b949e';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      const labelX = p + gi * groupW + groupW / 2;
      ctx.fillText(labels[gi], labelX, h - 6);

      for (let di = 0; di < nDs; di++) {
        const val = (data.datasets[di].data || [])[gi] || 0;
        const barH = (val / maxVal) * chartH;
        const x = p + gi * groupW + groupGap + di * barW;
        const y = p + chartH - barH;

        ctx.fillStyle = data.datasets[di].backgroundColor || '#58a6ff';
        ctx.fillRect(x, y, barW - 1, barH);
        ctx.strokeStyle = data.datasets[di].borderColor || '#58a6ff';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, barW - 1, barH);
      }
    }

    this._drawLegend(ctx, data.datasets, w, h);
  }

  _drawLegend(ctx, datasets, w, h) {
    const itemW = Math.min(w / datasets.length, 120);
    const startX = (w - itemW * datasets.length) / 2;
    const y = h - 4;

    for (let i = 0; i < datasets.length; i++) {
      const ds = datasets[i];
      const x = startX + i * itemW;
      ctx.fillStyle = ds.borderColor || ds.backgroundColor || '#58a6ff';
      ctx.fillRect(x, y - 8, 10, 10);
      ctx.fillStyle = '#8b949e';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      const label = (ds.label || '').substring(0, 10);
      ctx.fillText(label, x + 13, y);
    }
  }
}

// Make available globally
window.MiniChart = MiniChart;
