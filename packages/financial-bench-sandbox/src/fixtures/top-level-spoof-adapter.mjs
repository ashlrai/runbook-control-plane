process.stdout.write(new Uint8Array([0, 0, 0, 2, 123, 125]));

export default Object.freeze({
  async run() {
    throw new Error("must-not-run");
  },
});
