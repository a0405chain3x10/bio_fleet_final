import { Chart, BarController, BarElement, CategoryScale, Legend, LinearScale, Title, Tooltip, type Plugin } from 'chart.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Legend, Title, Tooltip);
Chart.defaults.color = '#c9d1d9';
Chart.defaults.borderColor = '#2d3642';

const VARIANT_COLORS: Record<string, string> = { baseline: '#8b98a8', biofleet: '#3fb950', 'biofleet-static': '#58a6ff' };

/** Draws ±std whiskers from dataset.errors (same order as data). */
const errorBars: Plugin<'bar'> = {
  id: 'errorBars',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((ds, i) => {
      const errs = (ds as unknown as { errors?: number[] }).errors;
      const meta = chart.getDatasetMeta(i);
      if (!errs || meta.hidden) return;
      const y = chart.scales.y;
      ctx.save();
      ctx.strokeStyle = '#e6edf3';
      ctx.lineWidth = 1.2;
      meta.data.forEach((bar, j) => {
        const v = ds.data[j] as number, e = errs[j];
        if (!Number.isFinite(v) || !e) return;
        const x = bar.x, top = y.getPixelForValue(v + e), bot = y.getPixelForValue(Math.max(0, v - e));
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bot);
        ctx.moveTo(x - 4, top);
        ctx.lineTo(x + 4, top);
        ctx.moveTo(x - 4, bot);
        ctx.lineTo(x + 4, bot);
        ctx.stroke();
      });
      ctx.restore();
    });
  },
};

export interface Series {
  label: string;
  values: number[];
  errors?: number[];
}

export function barChart(canvas: HTMLCanvasElement, title: string, labels: string[], series: Series[], yLabel: string): Chart<'bar'> {
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label, data: s.values, errors: s.errors, backgroundColor: VARIANT_COLORS[s.label] ?? '#d2a8ff',
      })) as never,
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { title: { display: true, text: title }, legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true, title: { display: true, text: yLabel } }, x: { ticks: { autoSkip: false, maxRotation: 60 } } },
    },
    plugins: [errorBars],
  });
}
