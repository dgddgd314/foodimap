window.FoodimapControls = (() => {
  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  // 마커 아래 이름이 화면 가장자리·컨트롤·다른 마커와 겹치지 않도록 고릅니다.
  function sparseLabels(points, { zoom, width, height, obstacles = [] }) {
    if (zoom < 14) return new Set();
    const chosen = [];
    const limit = Math.min(6, Math.ceil(points.length / 3));
    // 점수와 ID를 기준으로 고정된 순서를 사용해 조금 움직일 때 이름이 무작위로 바뀌지 않게 합니다.
    const ordered = [...points].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    for (const point of ordered) {
      // 이름의 투명한 패딩을 제외한 18px 글줄: top 34px + 패딩 2px - 마커 중심 20px.
      const label = { left: point.x - 72, right: point.x + 72, top: point.y + 16, bottom: point.y + 34 };
      if (label.left < 8 || label.right > width - 8 || label.top < 8 || label.bottom > height - 32) continue;
      if (obstacles.some(rect => overlaps(label, rect))) continue;
      if (chosen.some(other => Math.hypot(point.x - other.x, point.y - other.y) < 180)) continue;
      if (points.some(other => other.id !== point.id && overlaps(label, {
        left: other.x - 16, right: other.x + 16, top: other.y - 16, bottom: other.y + 16,
      }))) continue;
      chosen.push(point);
      if (chosen.length >= limit) break;
    }
    return new Set(chosen.map(point => point.id));
  }

  function currentLocation(geolocation, secureContext) {
    if (!secureContext) return Promise.reject(new Error("현재 위치는 HTTPS 또는 localhost에서 사용할 수 있습니다."));
    if (!geolocation) return Promise.reject(new Error("이 브라우저는 현재 위치 기능을 지원하지 않습니다."));
    return new Promise((resolve, reject) => {
      geolocation.getCurrentPosition(({ coords }) => {
        const { latitude, longitude, accuracy } = coords;
        if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude)
          || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0) {
          reject(new Error("현재 위치를 확인하지 못했습니다. 다시 시도해주세요."));
          return;
        }
        resolve({ latitude, longitude, accuracy });
      }, error => {
        const messages = {
          1: "위치 권한이 꺼져 있습니다. 브라우저의 사이트 설정에서 위치를 허용한 뒤 다시 눌러주세요.",
          2: "현재 위치를 확인하지 못했습니다. 기기의 위치 설정을 확인한 뒤 다시 눌러주세요.",
          3: "위치 확인 시간이 초과됐습니다. 다시 눌러주세요.",
        };
        reject(new Error(messages[error.code] || "현재 위치를 가져오지 못했습니다. 다시 시도해주세요."));
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }
  return { sparseLabels, currentLocation };
})();
