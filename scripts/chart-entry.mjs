import { Chart, ArcElement, DoughnutController, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
Chart.register(ArcElement, DoughnutController, BarController, BarElement, CategoryScale, LinearScale, Tooltip);
export { Chart };
