(function () {
  const LOG_PREFIX = "[GitHub HTML Preview][renderer]";

  window.addEventListener("message", (event) => {
    if (event.data?.type !== "RENDER_HTML") {
      return;
    }

    const html = event.data.html || "";
    console.info(LOG_PREFIX, "Rendering sandboxed HTML", {
      htmlLength: html.length,
      htmlStart: html.slice(0, 120)
    });

    document.open();
    document.write(html);
    document.close();
    installLinkHandler();
  });

  function installLinkHandler() {
    document.addEventListener(
      "click",
      (event) => {
        const link = event.target.closest?.("a[href]");

        if (!link) {
          return;
        }

        event.preventDefault();
        const href = link.href;
        console.info(LOG_PREFIX, "Link clicked", { href });
        parent.postMessage(
          {
            type: "PREVIEW_LINK_CLICK",
            href
          },
          "*"
        );
      },
      true
    );
  }

  installLinkHandler();
})();
