class LocalNarrativeProvider {
  id() {
    return 'local:narrative-simulated';
  }

  async callApi(prompt, context) {
    const vars = context && context.vars ? context.vars : {};
    const output = vars.output ?? vars.mockOutput ?? '';

    return {
      output: String(output),
    };
  }
}

module.exports = LocalNarrativeProvider;