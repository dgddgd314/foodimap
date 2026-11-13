/* 네이버 지도 SDK와 화면에서 사용하는 기능을 연결합니다. */
window.FoodimapNaverMap = (() => {
  function loadNaver(clientId, useGL) {
    if (window.naver?.maps?.Map) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let callbackReceived = false;
      let scriptLoaded = false;
      let settled = false;
      const timeout = window.setTimeout(() => fail("네이버 지도 응답이 없습니다."), 12000);
      function fail(message) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(message));
      }
      function finish() {
        if (settled || !callbackReceived || !scriptLoaded) return;
        if (typeof window.naver?.maps?.Map !== "function") return fail("네이버 지도 SDK는 응답했지만 지도 초기화에 실패했습니다.");
        settled = true;
        clearTimeout(timeout);
        resolve();
      }
      // 네이버 SDK가 공식적으로 제공하는 인증 실패 콜백입니다.
      window.navermap_authFailure = () => fail("네이버 지도 인증에 실패했습니다. Client ID와 등록 도메인을 확인해주세요.");
      window.foodimapNaverReady = () => {
        callbackReceived = true;
        finish();
      };
      // 일부 SDK 버전은 전역 API를 내보내기 전에 callback을 호출합니다.
      // 스크립트 실행 완료와 준비 콜백을 모두 확인한 뒤 지도를 생성합니다.
      script.onload = () => { scriptLoaded = true; finish(); };
      script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}&callback=foodimapNaverReady${useGL ? "&submodules=gl" : ""}`;
      script.onerror = () => fail("네이버 지도 SDK 다운로드에 실패했습니다. 브라우저의 외부 스크립트 차단이나 네트워크 연결을 확인해주세요.");
      document.head.append(script);
    });
  }

  // 지도와 마커를 만들고 이동·선택 동작을 네이버 SDK에 연결합니다.
  async function createNaver(container, clientId, styleId, onIssue) {
    await loadNaver(clientId, Boolean(styleId));
    const api = window.naver.maps;
    const latLng = ([lat, lng]) => new api.LatLng(lat, lng);
    const animate = () => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // 음식점만 숨기는 분류 설정은 발행한 Style Editor 스타일에서 관리합니다.
    // 스타일이 없으면 역·기관명까지 없애지 않고 기본 지도를 유지합니다.
    const map = new api.Map(container, {
      center: latLng([37.4812, 126.9527]), zoom: 16,
      ...(styleId ? { gl: true, customStyleId: styleId } : {}),
      tileTransition: false,
      zoomControl: false, mapTypeControl: false, minZoom: 5, maxZoom: 20,
    });
    let locationMarker;
    let accuracyCircle;
    let maxMarkerZIndex = 0;
    let pendingPresetMove;
    // 새 이동이나 직접 조작이 시작되면 이전 프리셋의 후속 확대를 취소합니다.
    function cancelPresetMove() {
      if (pendingPresetMove) api.Event.removeListener(pendingPresetMove);
      pendingPresetMove = null;
    }
    container.addEventListener("pointerdown", cancelPresetMove, { capture: true });
    container.addEventListener("wheel", cancelPresetMove, { passive: true });
    container.addEventListener("keydown", cancelPresetMove);
    window.navermap_authFailure = () => onIssue("네이버 지도 인증에 실패했습니다. Client ID와 등록 도메인을 확인해주세요.");
    return {
      getZoom: () => map.getZoom(),
      // 직접 누른 프리셋은 이동 효과를 실행하고 초기 배치·리사이즈는 즉시 반영합니다.
      applyView(view, { animated = false } = {}) {
        cancelPresetMove();
        const glMap = map.getMapbox?.();
        if (animated && glMap) {
          // 네이버 전환 래퍼는 essential을 전달하지 않아 GL 엔진에 직접 지정합니다.
          const flight = { duration: 900, essential: true };
          if (view.bounds) {
            glMap.fitBounds(view.bounds.map(([lat, lng]) => [lng, lat]), {
              ...flight, padding: { top: 65, right: 25, bottom: 65, left: 25 },
            });
          } else glMap.flyTo({ ...flight, center: [view.center[1], view.center[0]], zoom: view.naverZoom });
          return;
        }
        const transition = { duration: 700, easing: "easeOutCubic" };
        if (view.bounds) {
          const bounds = new api.LatLngBounds(latLng(view.bounds[0]), latLng(view.bounds[1]));
          const margin = { top: 65, right: 25, bottom: 65, left: 25 };
          if (animated) map.panToBounds(bounds, transition, margin);
          else map.fitBounds(bounds, margin);
        } else {
          const center = latLng(view.center);
          if (!animated) map.updateBy(center, view.naverZoom);
          else if (map.getZoom() === view.naverZoom && !map.getBounds().hasLatLng(center)) {
            // 먼 곳으로 같은 배율로 이동하면 SDK가 효과를 생략하므로 경로를 먼저 펼칩니다.
            pendingPresetMove = api.Event.once(map, "idle", () => {
              pendingPresetMove = null;
              map.morph(center, view.naverZoom, transition);
            });
            map.panToBounds(api.LatLngBounds.bounds(map.getCenter(), center), transition,
              { top: 65, right: 25, bottom: 65, left: 25 });
          } else map.morph(center, view.naverZoom, transition);
        }
      },
      // 평점 순위로 마커를 쌓고 선택·호버 해제 시 원래 순위로 돌려놓습니다.
      addMarker(place, content, zIndex) {
        maxMarkerZIndex = Math.max(maxMarkerZIndex, zIndex);
        const marker = new api.Marker({ map, position: latLng([place.lat, place.lng]), zIndex,
          icon: { content, size: new api.Size(40, 40), anchor: new api.Point(20, 20) } });
        return { select: selected => marker.setZIndex(selected ? maxMarkerZIndex + 1 : zIndex) };
      },
      contains: place => map.getBounds().hasLatLng(latLng([place.lat, place.lng])),
      // 확대·축소 버튼을 누르면 예약된 프리셋 이동을 취소하고 배율을 바꿉니다.
      zoom(delta) {
        cancelPresetMove();
        map.setZoom(Math.max(5, Math.min(20, map.getZoom() + delta)), animate());
      },
      // 현재 위치와 오차 범위를 갱신하고 해당 위치로 이동합니다.
      showLocation({ latitude, longitude, accuracy }) {
        cancelPresetMove();
        const position = latLng([latitude, longitude]);
        if (!locationMarker) {
          accuracyCircle = new api.Circle({ map, center: position, radius: accuracy,
            fillColor: "#4285f4", fillOpacity: 0.09, strokeColor: "#4285f4", strokeOpacity: 0.25,
            strokeWeight: 1, clickable: false });
          locationMarker = new api.Marker({ map, position, zIndex: 0,
            icon: { content: '<span class="location-dot" role="img" aria-label="현재 위치"></span>',
              size: new api.Size(20, 20), anchor: new api.Point(10, 10) } });
        } else {
          locationMarker.setPosition(position);
          accuracyCircle.setCenter(position);
          accuracyCircle.setRadius(accuracy);
        }
        const zoom = Math.max(16, map.getZoom());
        if (animate()) map.morph(position, zoom);
        else map.updateBy(position, zoom);
      },
      onMove: callback => api.Event.addListener(map, "idle", callback),
      onDrag: callback => api.Event.addListener(map, "dragstart", callback),
      onClick: callback => api.Event.addListener(map, "click", callback),
      // 컨테이너 크기에 맞춰 지도를 다시 배치합니다.
      resize() {
        cancelPresetMove();
        const center = map.getCenter();
        map.setSize(new api.Size(container.clientWidth, container.clientHeight));
        map.setCenter(center);
      },
    };
  }

  return {
    create(container, config, onIssue) {
      const key = typeof config.naverClientId === "string" ? config.naverClientId.trim() : "";
      const styleId = typeof config.naverStyleId === "string" ? config.naverStyleId.trim() : "";
      if (!key) return Promise.reject(new Error("네이버 지도 Client ID를 assets/config.js에 입력해주세요."));
      return createNaver(container, key, styleId, onIssue);
    },
  };
})();
