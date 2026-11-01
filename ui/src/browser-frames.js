export class BrowserFrames {
  constructor(createImage = () => new Image()) {
    this.createImage = createImage;
    this.target = null;
    this.canvas = null;
    this.frame = null;
    this.revision = 0;
  }
  select(target) {
    if (target === this.target) return;
    this.target = target;
    this.frame = null;
    ++this.revision;
    this.canvas?.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  bind(canvas) {
    if (canvas === this.canvas) return;
    this.canvas = canvas;
    ++this.revision;
    this.paint();
  }
  receive(target, frame) {
    if (!target || target !== this.target) return;
    this.frame = frame;
    this.paint();
  }
  paint() {
    const canvas = this.canvas, frame = this.frame, target = this.target;
    if (!canvas || !frame || !target) return;
    const revision = ++this.revision, image = this.createImage();
    image.onload = () => {
      if (revision !== this.revision || canvas !== this.canvas || target !== this.target) return;
      if (canvas.width !== image.width) canvas.width = image.width;
      if (canvas.height !== image.height) canvas.height = image.height;
      try {
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0);
      } catch {}
    };
    image.src = 'data:image/' + (frame.fmt === 'png' ? 'png' : 'jpeg') + ';base64,' + frame.data;
  }
}
