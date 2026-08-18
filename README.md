# AI Studio Dub & Sub (`dichvd`)
**Video Dubbing & Subtitle Generator powered by Google Gemini & Web Speech API**

Ứng dụng Web Studio AI hiện đại chạy trực tiếp trên trình duyệt, kết hợp mô hình **Google Gemini Multimodal** và **Web Speech API** để tự động:
- 🎙️ Nhận diện giọng nói chính xác từng câu kèm timestamp (`00:00:01.200`).
- 🌐 Dịch thuật phụ đề sang 10+ ngôn ngữ đích (Việt, Anh, Nhật, Hàn, Trung, Pháp, Đức, v.v.).
- 🎨 Hiển thị phụ đề động (Dynamic Subtitle Overlay) trên video player với nhiều kiểu dáng, cỡ chữ, màu sắc và độ mờ nền.
- 🗣️ Thuyết minh / Lồng tiếng tự động (AI Dubbing) theo thời gian thực.
- 🔉 Hiệu ứng **Audio Ducking**: Tự động giảm nhỏ âm lượng video gốc khi giọng đọc thuyết minh cất lên.
- 📥 Xuất file phụ đề chuẩn `.SRT`, `.VTT` và `.JSON` chỉ với 1 cú nhấp chuột.

---

## 🚀 Cấu Trúc Dự Án

```
dichvd/
├── index.html          # Giao diện chính Studio Dark Mode 2 cột
├── style.css           # Custom styles, Glassmorphism, Subtitle Presets, Timeline Track
├── gemini-api.js       # Module kết nối Google Gemini Multimodal API & JSON Parser
├── dubbing-engine.js   # Subtitle Sync Engine, Web Speech TTS & Audio Ducking
├── app.js              # Controller điều phối UI, Drag & Drop, Timeline Editor
└── README.md           # Hướng dẫn sử dụng
```

---

## 🛠️ Hướng Dẫn Chạy Cục Bộ (Local)

1. Clone repository về máy tính:
   ```bash
   git clone https://github.com/<your-username>/dichvd.git
   cd dichvd
   ```

2. Mở bằng bất kỳ HTTP Server đơn giản nào (hoặc mở trực tiếp file `index.html`):
   ```bash
   # Sử dụng Python
   python -m http.server 8000

   # Hoặc sử dụng Node.js (npx)
   npx serve .
   ```

3. Truy cập trên trình duyệt tại: `http://localhost:8000`

---

## 🔑 Hướng Dẫn Sử Dụng Gemini API Key

1. Lấy API Key miễn phí tại [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Dán API Key vào ô nhập tại Tab **⚡ AI Bóc Băng** và nhấn **Lưu**.
3. Khóa API được lưu trữ an toàn trong `localStorage` trên trình duyệt cá nhân của bạn.
