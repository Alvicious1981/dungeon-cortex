class LocalNarrativeProvider {
  id() {
    return 'local:narrative-fixture-harness';
  }

  async callApi(prompt, context) {
    const vars = context && context.vars ? context.vars : {};
    const caseName = vars.caseName;

    if (typeof caseName !== 'string' || caseName.trim().length === 0) {
      return { error: 'Local narrative fixtures require a non-empty vars.caseName.' };
    }
    if (typeof prompt !== 'string' || !prompt.includes(caseName)) {
      return { error: `Rendered prompt does not identify fixture: ${caseName}` };
    }

    let output = vars.mockOutput;
    if (vars.repeatOutput !== undefined) {
      const repeat = vars.repeatOutput;
      if (
        !repeat ||
        typeof repeat !== 'object' ||
        typeof repeat.text !== 'string' ||
        !Number.isInteger(repeat.count) ||
        repeat.count < 0 ||
        repeat.count > 10_000
      ) {
        return { error: `Invalid repeatOutput fixture for: ${caseName}` };
      }
      output = repeat.text.repeat(repeat.count);
    }

    if (typeof output !== 'string') {
      return { error: `Local narrative fixture has no string output: ${caseName}` };
    }

    return {
      output,
      metadata: {
        attackClass: typeof vars.attackClass === 'string' ? vars.attackClass : 'control',
        simulated: true,
      },
    };
  }
}

module.exports = LocalNarrativeProvider;
