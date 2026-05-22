(function exposeQrFixtures() {
  const matrices = {
    google: [
      "111111101000101111111",
      "100000101101001000001",
      "101110101111101011101",
      "101110101010101011101",
      "101110100111101011101",
      "100000101010101000001",
      "111111101010101111111",
      "000000000000000000000",
      "110011100000100101111",
      "100000010100111011010",
      "001111111000111010110",
      "010011011001110100011",
      "001010110101010110001",
      "000000001011100011010",
      "111111100101011110110",
      "100000101110010010001",
      "101110101110110100010",
      "101110100100100011111",
      "101110100010110010100",
      "100000101101100110000",
      "111111101011011110001"
    ],
    example: [
      "111111100011101111111",
      "100000101110101000001",
      "101110100011101011101",
      "101110101100101011101",
      "101110100100101011101",
      "100000101001001000001",
      "111111101010101111111",
      "000000000100000000000",
      "111110111001010101010",
      "011111011001111110011",
      "000111110000101100110",
      "111010011001110001110",
      "111111111110101000010",
      "000000001100100110101",
      "111111101111011001110",
      "100000100100010101111",
      "101110101001001010001",
      "101110101110111111000",
      "101110101110111001100",
      "100000101101110101100",
      "111111101011001101010"
    ]
  };

  function renderQrCode(target, matrix, label) {
    const quietZone = 4;
    const moduleSize = 12;
    const modules = matrix.length + quietZone * 2;
    const size = modules * moduleSize;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${modules} ${modules}`);
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    svg.setAttribute("shape-rendering", "crispEdges");

    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    background.setAttribute("width", String(modules));
    background.setAttribute("height", String(modules));
    background.setAttribute("fill", "#fff");
    svg.append(background);

    matrix.forEach((row, rowIndex) => {
      [...row].forEach((cell, columnIndex) => {
        if (cell !== "1") {
          return;
        }

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", String(columnIndex + quietZone));
        rect.setAttribute("y", String(rowIndex + quietZone));
        rect.setAttribute("width", "1");
        rect.setAttribute("height", "1");
        rect.setAttribute("fill", "#000");
        svg.append(rect);
      });
    });

    target.replaceChildren(svg);
  }

  window.QrFixtures = {
    matrices,
    renderQrCode
  };
})();
