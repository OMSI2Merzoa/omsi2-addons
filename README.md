1) 태그(Tag)
형식: <addonId>-v<버전>

예시:
ai_torres-v1.0
incheon_map-v2.5.1
hyundai_series-v4.1.0.7

참고: v는 있어도 되고 없어도 되지만, 우리 규칙은 -v 권장.
스크립트가 숫자만 뽑아 1.0, 2.5.1처럼 정상 인식해요.

2) 릴리즈 제목(Release title)
형식: [카테고리] 표시명
카테고리 키워드(대소문자 아무거나 OK, 대괄호 필수):
[map], [bus], [ai], [sound], [script], [patch]

예시:
[AI] KGM 토레스
[Map] 인천광역시 2.5.1
[Bus] 현대버스시리즈 4.1.0.7

스크립트는 제목/태그 문자열을 전부 소문자로 내려서 [...] 안 키워드를 찾습니다.
즉 [AI], [Ai]도 인식돼요. 대괄호는 꼭 넣어주세요.

3) 에셋 파일(Assets)
한 릴리즈당 압축파일 1개(권장) — *.zip 또는 *.7z
파일명 = 애드온 ID (소문자, 공백은 _)

예시: ai_torres.zip , incheon_map.7z

압축 내부 폴더 구조 권장(자동 배치와 깔끔한 설치를 위해):

최상위에 OMSI 표준 폴더 중 하나를 포함:
Vehicles/…, Maps/…, Sceneryobjects/…, Splines/…, Fonts/…, TicketPacks/…, Sound/…, Scripts/…

예시:
Vehicles/KGmobility_torres/... → 자동으로 OMSI\Vehicles\KGmobility_torres\...로 배치

4) 본문(Release body)

첫 줄: 짧은 설명(클라이언트에서 description으로 사용)
예) AI전용 KGM 토레스 차량입니다.

다음 줄부터: 변경점(선택)

- 신규 AI 스킨 추가
- 주간 주행 패턴 업데이트
