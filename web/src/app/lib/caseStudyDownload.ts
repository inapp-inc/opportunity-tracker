import html2canvas from "html2canvas";

/** Wait until fonts and layout have settled before capturing the DOM. */
export async function waitForDomPaint() {
  await document.fonts.ready;
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export async function captureCaseStudyElement(element: HTMLElement) {
  await waitForDomPaint();

  const width = Math.ceil(element.scrollWidth || element.clientWidth);
  const height = Math.ceil(element.scrollHeight || element.clientHeight);
  if (width < 1 || height < 1) {
    throw new Error("Case study content is not ready to capture yet.");
  }

  return html2canvas(element, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    logging: false,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scrollX: 0,
    scrollY: 0,
    onclone: (_doc, node) => {
      if (!(node instanceof HTMLElement)) return;
      node.style.overflow = "visible";
      node.style.width = `${width}px`;
      node.style.maxWidth = `${width}px`;
      node.style.background = "#ffffff";
    },
  });
}

export async function downloadCaseStudyPng(
  element: HTMLElement,
  filename: string
) {
  const canvas = await captureCaseStudyElement(element);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png")
  );
  if (!blob) throw new Error("Failed to render image");

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
