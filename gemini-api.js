/**
 * gemini-api.js
 * Module xử lý kết nối Google Gemini API (Multimodal Speech-to-Text & Translation)
 * Hỗ trợ các model: gemini-2.0-flash, gemini-1.5-flash, gemini-2.5-flash, gemini-1.5-pro
 */

class GeminiService {
  constructor() {
    this.storageKey = 'gemini_studio_api_key';
    this.modelStorageKey = 'gemini_studio_model';
    this.apiKey = this.loadApiKey();
    this.model = this.loadModel() || 'gemini-2.0-flash';
  }

  /**
   * Lưu API Key vào localStorage
   */
  saveApiKey(key) {
    this.apiKey = (key || '').trim();
    if (this.apiKey) {
      localStorage.setItem(this.storageKey, this.apiKey);
    } else {
      localStorage.removeItem(this.storageKey);
    }
  }

  /**
   * Tải API Key từ localStorage
   */
  loadApiKey() {
    return localStorage.getItem(this.storageKey) || '';
  }

  /**
   * Lưu Model đã chọn
   */
  saveModel(modelName) {
    this.model = modelName || 'gemini-2.0-flash';
    localStorage.setItem(this.modelStorageKey, this.model);
  }

  /**
   * Tải Model đã lưu
   */
  loadModel() {
    return localStorage.getItem(this.modelStorageKey) || 'gemini-2.0-flash';
  }

  /**
   * Chuyển đổi File sang Base64
   * @param {File} file
   * @param {Function} onProgress
   * @returns {Promise<{base64Data: string, mimeType: string}>}
   */
  async fileToBase64(file, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };

      reader.onload = () => {
        const result = reader.result;
        // Bóc tách tiền tố "data:video/mp4;base64,"
        const commaIndex = result.indexOf(',');
        const base64Data = commaIndex !== -1 ? result.substring(commaIndex + 1) : result;
        const mimeType = file.type || 'video/mp4';
        resolve({ base64Data, mimeType });
      };

      reader.onerror = (error) => {
        reject(new Error(`Lỗi đọc tệp video: ${error.message || 'Không xác định'}`));
      };

      reader.readAsDataURL(file);
    });
  }

  /**
   * Gọi Gemini API để bóc băng và dịch thuật video
   * @param {Object} params
   * @param {File} params.file - File video hoặc audio
   * @param {string} params.targetLang - Tên ngôn ngữ đích (ví dụ: "Tiếng Việt", "English")
   * @param {string} [params.customPrompt] - Chỉ dẫn bổ sung (tone giọng, thuật ngữ)
   * @param {Function} [params.onStatusUpdate] - Callback cập nhật tiến trình
   * @returns {Promise<Array<{start: string, end: string, original: string, translated: string}>>}
   */
  async transcribeAndTranslate({ file, targetLang, customPrompt = '', onStatusUpdate = () => {} }) {
    if (!this.apiKey) {
      throw new Error('Chưa cung cấp Google Gemini API Key. Vui lòng nhập API Key ở bảng điều khiển bên phải.');
    }

    onStatusUpdate('Đang chuyển đổi tệp video sang dữ liệu Base64...', 10);
    const { base64Data, mimeType } = await this.fileToBase64(file, (percent) => {
      onStatusUpdate(`Đang nạp video vào bộ nhớ (${percent}%)...`, 10 + Math.round(percent * 0.2));
    });

    onStatusUpdate(`Đang gửi yêu cầu đến mô hình Gemini (${this.model})...`, 35);

    const systemPrompt = `Bạn là một chuyên gia bóc băng âm thanh (Speech-to-Text) và biên dịch phụ đề video chuyên nghiệp.
Nhiệm vụ của bạn:
1. Lắng nghe thật kỹ toàn bộ âm thanh/lời thoại trong video.
2. Nhận diện giọng nói chính xác từng câu kèm mốc thời gian bắt đầu (start) và kết thúc (end) theo định dạng "HH:MM:SS.mmm" (ví dụ: "00:00:01.200", "00:00:04.500").
3. Giữ nguyên văn bản gốc trong trường "original".
4. Dịch toàn bộ nội dung sang ngôn ngữ đích: "${targetLang}". Bản dịch trong trường "translated" phải tự nhiên, gãy gọn, khớp ngữ cảnh và phù hợp để lồng tiếng.
${customPrompt ? `Yêu cầu thêm từ người dùng: ${customPrompt}` : ''}

QUAN TRỌNG:
- Trả về DUY NHẤT định dạng JSON mảng (Array of Objects), không kèm lời giải thích, không kèm markdown bọc ngoài nếu có thể.
- Cấu trúc mẫu chuẩn:
[
  {
    "start": "00:00:00.500",
    "end": "00:00:03.200",
    "original": "Hello and welcome to this video tutorial.",
    "translated": "Xin chào và chào mừng bạn đến với video hướng dẫn này."
  }
]`;

    const userPrompt = `Hãy nghe đoạn video này, nhận diện giọng nói chính xác từng câu kèm mốc thời gian bắt đầu (start) và kết thúc (end), sau đó dịch sang ngôn ngữ "${targetLang}". Trả về duy nhất định dạng JSON mảng các object: [{ "start": "00:00:01.200", "end": "00:00:04.500", "original": "...", "translated": "..." }]`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            },
            {
              text: userPrompt
            }
          ]
        }
      ],
      systemInstruction: {
        parts: [
          {
            text: systemPrompt
          }
        ]
      },
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        responseMimeType: 'application/json'
      }
    };

    onStatusUpdate('AI đang phân tích âm thanh, bóc băng giọng nói & biên dịch...', 60);

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
    } catch (networkErr) {
      throw new Error(`Lỗi kết nối mạng đến Google Gemini API: ${networkErr.message}. Vui lòng kiểm tra kết nối Internet.`);
    }

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorJson = await response.json();
        errorDetail = errorJson.error?.message || JSON.stringify(errorJson);
      } catch (e) {
        errorDetail = await response.text();
      }

      if (response.status === 400 && errorDetail.includes('API_KEY_INVALID')) {
        throw new Error('API Key không hợp lệ. Vui lòng kiểm tra lại Google Gemini API Key.');
      } else if (response.status === 429) {
        throw new Error('Đã vượt quá giới hạn lượt gọi API (Rate Limit 429). Vui lòng thử lại sau vài giây hoặc đổi Model.');
      } else {
        throw new Error(`Gemini API báo lỗi (${response.status}): ${errorDetail}`);
      }
    }

    onStatusUpdate('Đang giải mã và định dạng cấu trúc phụ đề...', 85);
    const data = await response.json();

    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content?.parts?.[0]?.text) {
      throw new Error('Không nhận được nội dung phản hồi hợp lệ từ Gemini. Video có thể không có âm thanh thoại.');
    }

    const rawText = candidate.content.parts[0].text;
    const parsedSegments = this.parseJsonSafely(rawText);

    if (!Array.isArray(parsedSegments) || parsedSegments.length === 0) {
      throw new Error('AI không phát hiện hoặc không bóc tách được dòng thoại nào trong video.');
    }

    onStatusUpdate('Hoàn tất xử lý bóc băng & dịch thuật!', 100);
    return this.normalizeSegments(parsedSegments);
  }

  /**
   * Bóc tách JSON an toàn từ phản hồi text
   * Xử lý trường hợp có markdown fences hoặc ký tự lạ
   */
  parseJsonSafely(rawText) {
    let cleanText = rawText.trim();

    // Loại bỏ markdown code fence ```json ... ``` nếu có
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.substring(7);
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.substring(3);
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    cleanText = cleanText.trim();

    // Thử parse trực tiếp
    try {
      return JSON.parse(cleanText);
    } catch (err1) {
      // Nếu thất bại, tìm mảng JSON [ ... ] bên trong văn bản
      const arrayMatch = cleanText.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0]);
        } catch (err2) {
          console.error('Regex parse error:', err2);
        }
      }
      throw new Error(`Lỗi định dạng dữ liệu phản hồi từ AI: ${err1.message}. Raw text: ${cleanText.slice(0, 150)}...`);
    }
  }

  /**
   * Chuẩn hóa danh sách segment để đảm bảo đầy đủ các trường start, end, original, translated
   */
  normalizeSegments(segments) {
    return segments.map((item, index) => {
      let start = item.start || '00:00:00.000';
      let end = item.end || '00:00:02.000';

      // Nếu trả về dạng số giây thay vì chuỗi thời gian, chuyển sang HH:MM:SS.mmm
      if (typeof start === 'number') {
        start = this.secondsToTimeString(start);
      }
      if (typeof end === 'number') {
        end = this.secondsToTimeString(end);
      }

      return {
        id: item.id || `seg_${Date.now()}_${index}`,
        start: String(start).trim(),
        end: String(end).trim(),
        original: String(item.original || item.text || '').trim(),
        translated: String(item.translated || item.translation || item.original || '').trim()
      };
    });
  }

  /**
   * Helper chuyển giây sang chuỗi thời gian HH:MM:SS.mmm
   */
  secondsToTimeString(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const ms = Math.floor((totalSeconds % 1) * 1000);

    const pad = (n, width = 2) => String(n).padStart(width, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)}`;
  }

  /**
   * Dữ liệu mẫu demo để người dùng kiểm thử ngay khi chưa có video hoặc API Key
   */
  getDemoSegments(targetLang = 'Tiếng Việt') {
    const isVietnamese = targetLang.toLowerCase().includes('việt') || targetLang.toLowerCase().includes('viet');

    if (isVietnamese) {
      return [
        {
          id: 'seg_demo_1',
          start: '00:00:00.500',
          end: '00:00:03.800',
          original: 'Welcome to the future of AI-powered video dubbing and subtitle studio.',
          translated: 'Chào mừng bạn đến với phòng thu phụ đề và lồng tiếng video bằng AI.'
        },
        {
          id: 'seg_demo_2',
          start: '00:00:04.200',
          end: '00:00:07.600',
          original: 'With Google Gemini, we can transcribe any speech with precision timestamps.',
          translated: 'Với Google Gemini, chúng ta có thể bóc băng giọng nói với mốc thời gian cực kỳ chuẩn xác.'
        },
        {
          id: 'seg_demo_3',
          start: '00:00:08.000',
          end: '00:00:11.500',
          original: 'The smart audio ducking feature automatically lowers background sound.',
          translated: 'Tính năng hạ âm thông minh tự động giảm nhỏ âm thanh nền khi có thuyết minh.'
        },
        {
          id: 'seg_demo_4',
          start: '00:00:12.000',
          end: '00:00:15.800',
          original: 'You can customize typography, live preview, and export to SRT or VTT instantly.',
          translated: 'Bạn có thể tùy biến phụ đề, xem trước trực tiếp và xuất file SRT hoặc VTT ngay lập tức.'
        }
      ];
    } else {
      return [
        {
          id: 'seg_demo_1',
          start: '00:00:00.500',
          end: '00:00:03.800',
          original: 'Chào mừng các bạn đến với công cụ lồng tiếng và tạo phụ đề tự động.',
          translated: 'Welcome to the automated video dubbing and subtitle generation tool.'
        },
        {
          id: 'seg_demo_2',
          start: '00:00:04.200',
          end: '00:00:07.600',
          original: 'Hệ thống tự động đồng bộ giọng đọc theo từng mốc thời gian của video.',
          translated: 'The system automatically syncs voiceover to each timestamp in the video.'
        },
        {
          id: 'seg_demo_3',
          start: '00:00:08.000',
          end: '00:00:11.500',
          original: 'Bạn có thể chỉnh sửa lại các câu thoại và tải về file phụ đề chuẩn SRT.',
          translated: 'You can edit transcript lines and download standard SRT subtitle files.'
        }
      ];
    }
  }
}

// Khởi tạo instance toàn cục
window.geminiService = new GeminiService();
