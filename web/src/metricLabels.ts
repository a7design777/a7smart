/** Ключі, які сервер зберігає в readings (HISTORICAL_KEYS), і їхні підписи. */
export const METRIC_LABELS: Record<string, string> = {
  temperature: 'Температура',
  humidity: 'Вологість',
  power: 'Потужність',
  energy: 'Спожито',
  battery: 'Заряд / батарея',
  gas: 'Газ',
  input_power: 'Вхід станції',
  output_power: 'Вихід станції',
};

export const CHARTABLE_KEYS = Object.keys(METRIC_LABELS);
