export default class SwitchableStream extends TransformStream {
  private _controller: TransformStreamDefaultController | null = null;
  private _currentReader: ReadableStreamDefaultReader | null = null;
  private _switches = 0;
  private _isClosed = false;
  private _isReading = false;

  constructor() {
    let controllerRef: TransformStreamDefaultController | undefined;

    super({
      start(controller) {
        controllerRef = controller;
      },
    });

    if (controllerRef === undefined) {
      throw new Error('Controller not properly initialized');
    }

    this._controller = controllerRef;
  }

  async switchSource(newStream: ReadableStream) {
    if (this._isClosed) {
      console.warn('Attempt to switch source on closed stream');
      return;
    }

    // 等待当前的读取操作完成
    while (this._isReading) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    if (this._currentReader) {
      try {
        await this._currentReader.cancel();
      } catch (error) {
        console.warn('Error cancelling previous reader:', error);
      }
    }

    try {
      this._currentReader = newStream.getReader();
      await this._pumpStream();
    } catch (error) {
      console.error('Error in switchSource:', error);
      if (!this._isClosed && this._controller) {
        this._controller.error(error);
      }
    }

    this._switches++;
  }

  private async _pumpStream() {
    if (!this._currentReader || !this._controller || this._isClosed) {
      console.warn('Stream is not properly initialized or is closed');
      return;
    }

    this._isReading = true;

    try {
      while (!this._isClosed) {
        const { done, value } = await this._currentReader.read();

        if (done) {
          break;
        }

        if (this._controller && !this._isClosed) {
          this._controller.enqueue(value);
        } else {
          break;
        }
      }
    } catch (error) {
      console.error('Error in _pumpStream:', error);
      if (!this._isClosed && this._controller) {
        this._controller.error(error);
      }
    } finally {
      this._isReading = false;
    }
  }

  close() {
    if (this._isClosed) {
      return;
    }

    this._isClosed = true;

    if (this._currentReader) {
      try {
        this._currentReader.cancel();
      } catch (error) {
        console.warn('Error cancelling reader during close:', error);
      }
    }

    if (this._controller) {
      try {
        this._controller.terminate();
      } catch (error) {
        console.warn('Error terminating controller during close:', error);
      }
    }
  }

  get switches() {
    return this._switches;
  }
}
