export function InfoPanel({
  model,
  size,
  strategy,
  processing,
  tradeoff,
}: {
  model: string;
  size: number | string;
  strategy: string;
  processing: string;
  tradeoff: string;
}) {
  return (
    <div className="info-panel">
      <span>
        <b>Row Model</b>
        {model}
      </span>
      <span>
        <b>Dataset</b>
        {typeof size === 'number' ? size.toLocaleString('en-US') : size}
      </span>
      <span>
        <b>Updates</b>
        {strategy}
      </span>
      <span>
        <b>Processing</b>
        {processing}
      </span>
      <span>
        <b>Edition</b>Community
      </span>
      <p>{tradeoff}</p>
    </div>
  );
}
