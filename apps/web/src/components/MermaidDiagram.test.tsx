import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaid }));
vi.mock("react-dom", () => ({ createPortal: (children: unknown) => children }));

import {
  MermaidDiagram,
  cacheRenderedDiagram,
  mermaidSvgNaturalSize,
  renderMermaidDiagram,
} from "./MermaidDiagram";
import { serializeMarkdownCodeFence } from "../markdown-clipboard";

describe("renderMermaidDiagram", () => {
  beforeEach(() => {
    mermaid.initialize.mockReset();
    mermaid.render.mockReset();
  });

  it("renders with strict security and the selected theme", async () => {
    mermaid.render.mockResolvedValue({ svg: "<svg />" });

    await renderMermaidDiagram("diagram-1", "flowchart LR\nA-->B", "dark");

    expect(mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "suppressErrorRendering",
        "maxEdges",
        "themeCSS",
        "fontFamily",
        "altFontFamily",
      ],
      theme: "dark",
    });
    expect(mermaid.render).toHaveBeenCalledWith("diagram-1", "flowchart LR\nA-->B");
  });

  it("continues rendering after an invalid diagram", async () => {
    mermaid.render
      .mockRejectedValueOnce(new Error("Invalid diagram"))
      .mockResolvedValueOnce({ svg: "<svg />" });

    await expect(renderMermaidDiagram("diagram-1", "invalid", "light")).rejects.toThrow();
    await expect(
      renderMermaidDiagram("diagram-2", "sequenceDiagram\nA->>B: Hi", "light"),
    ).resolves.toEqual({ svg: "<svg />" });
  });

  it("skips queued work after its diagram unmounts", async () => {
    let finishFirstRender!: (result: { svg: string }) => void;
    mermaid.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirstRender = resolve;
        }),
    );

    const first = renderMermaidDiagram("diagram-1", "flowchart LR\nA-->B", "light");
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    const second = renderMermaidDiagram("diagram-2", "flowchart LR\nB-->C", "light", () => false);
    finishFirstRender({ svg: "<svg />" });

    await first;
    await expect(second).resolves.toBeNull();
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

  it("chooses a fence longer than backtick runs in copied source", () => {
    expect(serializeMarkdownCodeFence("flowchart LR\n%% ``` in a comment", "mermaid")).toBe(
      "````mermaid\nflowchart LR\n%% ``` in a comment\n````\n\n",
    );
  });
});

describe("MermaidDiagram expand", () => {
  const code = "flowchart LR\nExpandA-->ExpandB";

  beforeEach(() => {
    mermaid.initialize.mockReset();
    mermaid.render.mockReset();
    // Seeds the module-level SVG cache so SSR reads the rendered diagram
    // without running effects, exactly like a remount after scrolling.
    cacheRenderedDiagram("dark", code, "<svg>expanded-diagram</svg>");
  });

  it("uses the cached SVG on remount and opens a closable source-copy dialog", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("document", { activeElement: null });
    vi.stubGlobal(
      "Element",
      class {
        closest() {
          return null;
        }
      },
    );
    vi.stubGlobal(
      "HTMLElement",
      class {
        isConnected = false;
      },
    );
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSelection: () => null,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          <MermaidDiagram code={code} theme="dark" fallback={<div>fallback</div>} />,
        );
      });
      expect(mermaid.render).not.toHaveBeenCalled();
      expect(renderer!.root.findAllByProps({ children: "fallback" })).toHaveLength(0);
      await act(async () =>
        renderer!.root
          .findByProps({ "aria-label": "Expand diagram" })
          .props.onClick({ target: null }),
      );
      expect(renderer!.root.findAllByProps({ role: "dialog" })).toHaveLength(1);
      await act(async () =>
        renderer!.root.findByProps({ "aria-label": "Copy diagram source" }).props.onClick(),
      );
      expect(writeText).toHaveBeenCalledWith(serializeMarkdownCodeFence(code, "mermaid"));
      await act(async () =>
        renderer!.root
          .findByProps({ "aria-label": "Close diagram preview", tabIndex: -1 })
          .props.onClick(),
      );
      expect(renderer!.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });
});

describe("mermaidSvgNaturalSize", () => {
  it("reads the natural size from the viewBox", () => {
    expect(
      mermaidSvgNaturalSize(
        '<svg width="100%" style="max-width: 444.89px;" viewBox="0 0 444.890625 174">',
      ),
    ).toEqual({ width: 444.890625, height: 174 });
  });

  it("rejects missing or degenerate viewBoxes", () => {
    expect(mermaidSvgNaturalSize("<svg>no viewBox</svg>")).toBeNull();
    expect(mermaidSvgNaturalSize('<svg viewBox="0 0 0 100">')).toBeNull();
    expect(mermaidSvgNaturalSize('<svg viewBox="nonsense">')).toBeNull();
  });
});

describe("MermaidDiagram visibility gating", () => {
  const code = "flowchart LR\nGatedA-->GatedB";

  it("defers rendering until the diagram nears the viewport", async () => {
    let enter!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          enter = () => callback([{ isIntersecting: true }]);
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mermaid.render.mockResolvedValue({ svg: "<svg>visible</svg>" });
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          <MermaidDiagram code={code} theme="dark" fallback={<div>gated-fallback</div>} />,
          {
            createNodeMock: () => ({}),
          },
        );
      });
      expect(mermaid.render).not.toHaveBeenCalled();
      await act(async () => enter());
      expect(mermaid.render).toHaveBeenCalledTimes(1);
      expect(renderer!.root.findAllByProps({ "aria-label": "Expand diagram" })).toHaveLength(1);
      expect(disconnect).toHaveBeenCalled();
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });
});
