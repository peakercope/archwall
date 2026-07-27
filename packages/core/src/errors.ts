export class ArchWallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class IrVersionMismatchError extends ArchWallError {
  constructor(
    readonly graphVersion: string,
    readonly coreVersion: string,
  ) {
    super(
      `Incompatible graph IR: adapter produced irVersion ${graphVersion}, but @archwall/core supports ${coreVersion} (majors must match). Upgrade the adapter or core so their IR majors align.`,
    );
  }
}
