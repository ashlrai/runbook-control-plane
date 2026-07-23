type CapitalRailProps = {
  budget: number;
  deployed: number;
  reserved: number;
  hardStop: number;
};

export function CapitalRail({
  budget,
  deployed,
  reserved,
  hardStop,
}: CapitalRailProps) {
  const deployedPercent = Math.min(100, (deployed / budget) * 100);
  const reservePercent = Math.min(100, (reserved / budget) * 100);
  const stopPercent = Math.max(0, 100 - hardStop);

  return (
    <section className="capital-module" aria-labelledby="capital-title">
      <div className="module-heading">
        <div>
          <span className="eyebrow">Capital rail</span>
          <h2 id="capital-title">Exposure envelope</h2>
        </div>
        <span className="live-pill"><i /> live ledger</span>
      </div>

      <div className="capital-layout">
        <div className="rail-wrap" aria-label={`${deployedPercent}% of budget deployed`}>
          <div className="rail-scale">
            <span>$500</span>
            <span>$375</span>
            <span>$250</span>
            <span>$125</span>
            <span>$0</span>
          </div>
          <div className="rail-track">
            <div className="rail-stop" style={{ bottom: `${stopPercent}%` }}>
              <b>8% stop</b>
            </div>
            <div className="rail-reserve" style={{ height: `${reservePercent}%` }} />
            <div className="rail-fill" style={{ height: `${deployedPercent}%` }}>
              <span />
            </div>
          </div>
        </div>

        <dl className="capital-stats">
          <div>
            <dt>Experiment budget</dt>
            <dd>${budget.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Deployed</dt>
            <dd>${deployed.toLocaleString()}</dd>
            <span>{deployedPercent.toFixed(0)}% of budget</span>
          </div>
          <div>
            <dt>Protected reserve</dt>
            <dd>${reserved.toLocaleString()}</dd>
            <span>Unavailable to agent</span>
          </div>
          <div className="capital-available">
            <dt>Still deployable</dt>
            <dd>${(budget - deployed - reserved).toLocaleString()}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
