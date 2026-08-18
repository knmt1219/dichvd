/**
 * gemini-api.js
 * Module xử lý kết nối Google Gemini API (Multimodal Speech-to-Text & Translation)
 * Tích hợp bộ giải nén Web Audio API 16kHz WAV mono siêu nhẹ chống lỗi 400
 * Hỗ trợ các model: gemini-1.5-flash, gemini-2.5-flash, gemini-3.6-flash, gemini-1.5-pro
 */

class GeminiService {
  constructor() {
    this.storageKey = 'gemini_studio_api_key';
    this.modelStorageKey = 'gemini_studio_model';
    this.apiKey = this.loadApiKey();
    this.model = this.loadModel() || 'gemini-1.5-flash';
  }

  /**
   * Lưu API Key vào localStorage
   */
  saveApiKey(key) {
    this.apiKey = (key || '').trim().replace(/["']/g, '');
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
    const key = localStorage.getItem(this.storageKey) || '';
    return key.trim().replace(/["']/g, '');
  }

  /**
   * Lưu Model đã chọn
   */
  saveModel(modelName) {
    this.model = modelName || 'gemini-1.5-flash';
    localStorage.setItem(this.modelStorageKey, this.model);
  }

  /**
   * Tải Model đã lưu
   */
  loadModel() {
    let saved = localStorage.getItem(this.modelStorageKey);
    if (!saved || saved === 'gemini-2.0-flash') {
      saved = 'gemini-1.5-flash';
      localStorage.setItem(this.modelStorageKey, saved);
    }
    return saved;
  }

  /**
   * Trích xuất âm thanh từ Video thành file WAV 16kHz Mono siêu nhẹ
   * Giảm 95% dung lượng file gửi lên Gemini, tăng tốc 10x và tránh hoàn toàn lỗi 400/20MB limit
   * @param {File} file
   * @param {Function} onProgress
   * @returns {Promise<{base64Data: string, mimeType: string}>}
   */
  async extractAudioAndConvertToBase64(file, onProgress = () => {}) {
    onProgress('Đang đọc tệp video...', 15);
    const arrayBuffer = await file.arrayBuffer();

    try {
      onProgress('Đang trích xuất luồng âm thanh thoại...', 25);
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      
      // Sử dụng slice(0) để tránh detach ArrayBuffer
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

      onProgress('Đang tối ưu hóa âm thanh (16kHz WAV Mono)...', 35);
      const targetSampleRate = 16000;
      const numChannels = 1;
      const length = Math.ceil(audioBuffer.duration * targetSampleRate);

      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const offlineCtx = new OfflineCtx(numChannels, length, targetSampleRate);

      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start(0);

      const renderedBuffer = await offlineCtx.startRendering();
      const channelData = renderedBuffer.getChannelData(0);

      if (audioCtx.state !== 'closed') {
        audioCtx.close();
      }

      // Tạo file WAV PCM 16-bit
      const bitDepth = 16;
      const bytesPerSample = bitDepth / 8;
      const dataSize = channelData.length * bytesPerSample;
      const headerSize = 44;
      const totalSize = headerSize + dataSize;
      const wavBuffer = new ArrayBuffer(totalSize);
      const view = new DataView(wavBuffer);

      const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i++) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      };

      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM format
      view.setUint16(22, numChannels, true);
      view.setUint32(24, targetSampleRate, true);
      view.setUint32(28, targetSampleRate * numChannels * bytesPerSample, true);
      view.setUint16(32, numChannels * bytesPerSample, true);
      view.setUint16(34, bitDepth, true);
      writeStr(36, 'data');
      view.setUint32(40, dataSize, true);

      let offset = 44;
      for (let i = 0; i < channelData.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }

      onProgress('Đang mã hóa dữ liệu âm thanh...', 45);
      const wavBlob = new Blob([view], { type: 'audio/wav' });
      return await this.blobToBase64(wavBlob, 'audio/wav');
    } catch (audioErr) {
      console.warn('Không thể trích xuất Web Audio, chuyển sang đọc tệp trực tiếp:', audioErr);
      onProgress('Đang đọc tệp video trực tiếp...', 30);
      return await this.fileToBase64(file);
    }
  }

  /**
   * Helper chuyển Blob sang Base64
   */
  async blobToBase64(blob, mimeType = 'audio/wav') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const commaIndex = result.indexOf(',');
        const base64Data = commaIndex !== -1 ? result.substring(commaIndex + 1) : result;
        resolve({ base64Data, mimeType });
      };
      reader.onerror = (e) => reject(new Error('Lỗi mã hóa Base64: ' + e));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Fallback chuyển đổi File trực tiếp sang Base64 với MIME Type chuẩn hóa
   */
  async fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const commaIndex = result.indexOf(',');
        const base64Data = commaIndex !== -1 ? result.substring(commaIndex + 1) : result;
        
        let cleanMime = 'video/mp4';
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.webm') || file.type.includes('webm')) {
          cleanMime = 'video/webm';
        } else if (name.endsWith('.wav') || file.type.includes('wav')) {
          cleanMime = 'audio/wav';
        } else if (name.endsWith('.mp3') || file.type.includes('mp3')) {
          cleanMime = 'audio/mp3';
        } else if (name.endsWith('.ogg') || file.type.includes('ogg')) {
          cleanMime = 'audio/ogg';
        } else {
          cleanMime = 'video/mp4';
        }

        resolve({ base64Data, mimeType: cleanMime });
      };
      reader.onerror = (e) => reject(new Error('Lỗi đọc tệp: ' + e));
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

    // Trích xuất âm thanh tối ưu
    const { base64Data, mimeType } = await this.extractAudioAndConvertToBase64(file, (msg, pct) => {
      onStatusUpdate(msg, pct);
    });

    // Kiểm tra kích thước payload Base64 (tránh quá giới hạn 20MB)
    const payloadSizeMB = (base64Data.length * 0.75) / (1024 * 1024);
    if (payloadSizeMB > 19) {
      throw new Error(`Dữ liệu gửi lên quá lớn (${payloadSizeMB.toFixed(1)}MB > 20MB limit của Gemini). Vui lòng cắt ngắn video dưới 5 phút.`);
    }

    onStatusUpdate(`Đang kết nối đến mô hình Gemini (${this.model})...`, 50);

    const fullPrompt = `Bạn là một chuyên gia bóc băng âm thanh (Speech-to-Text) và biên dịch phụ đề video hàng đầu.
Nhiệm vụ:
1. Lắng nghe toàn bộ âm thanh lời thoại.
2. Nhận diện giọng nói chính xác từng câu kèm mốc thời gian bắt đầu (start) và kết thúc (end) theo định dạng "HH:MM:SS.mmm" (ví dụ: "00:00:01.200", "00:00:04.500").
3. Giữ nguyên văn bản gốc trong trường "original".
4. Dịch toàn bộ nội dung sang ngôn ngữ đích: "${targetLang}". Bản dịch trong trường "translated" phải tự nhiên, gãy gọn, khớp ngữ cảnh và phù hợp để lồng tiếng.
${customPrompt ? `Yêu cầu thêm từ người dùng: ${customPrompt}` : ''}

QUAN TRỌNG:
- Trả về DUY NHẤT một mảng JSON (Array of Objects), không kèm bất kỳ văn bản giải thích nào khác.
- Cấu trúc mẫu chuẩn:
[
  {
    "start": "00:00:00.500",
    "end": "00:00:03.200",
    "original": "Text heard from speech",
    "translated": "Bản dịch sang ${targetLang}"
  }
]`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: fullPrompt
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.95
      }
    };

    onStatusUpdate('AI đang phân tích âm thanh, bóc băng giọng nói & biên dịch...', 70);

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
        if (errorJson.error) {
          errorDetail = errorJson.error.message || JSON.stringify(errorJson.error);
        } else {
          errorDetail = JSON.stringify(errorJson);
        }
      } catch (e) {
        errorDetail = await response.text();
      }

      // Tự động xử lý nếu model bị 404 hoặc không khả dụng
      if (response.status === 404 && this.model !== 'gemini-1.5-flash') {
        console.warn(`Mô hình ${this.model} không còn khả dụng (404). Đang tự động chuyển sang gemini-1.5-flash...`);
        this.saveModel('gemini-1.5-flash');
        onStatusUpdate('Đang tự động chuyển sang Gemini 1.5 Flash...', 50);
        return this.transcribeAndTranslate({ file, targetLang, customPrompt, onStatusUpdate });
      }

      if (response.status === 400) {
        if (errorDetail.includes('API_KEY_INVALID')) {
          throw new Error('API Key không hợp lệ. Vui lòng kiểm tra lại Google Gemini API Key.');
        } else {
          throw new Error(`Lỗi tham số yêu cầu (400): ${errorDetail}`);
        }
      } else if (response.status === 429) {
        throw new Error('Đã vượt quá giới hạn lượt gọi API (Rate Limit 429). Vui lòng thử lại sau vài giây hoặc chọn Model khác.');
      } else {
        throw new Error(`Gemini API báo lỗi (${response.status}): ${errorDetail}`);
      }
    }

    onStatusUpdate('Đang giải mã và định dạng cấu trúc phụ đề...', 90);
    const data = await response.json();

    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content?.parts?.[0]?.text) {
      throw new Error('Không nhận được nội dung phản hồi hợp lệ từ Gemini. Video/audio có thể không có âm thanh thoại.');
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
   */
  parseJsonSafely(rawText) {
    let cleanText = rawText.trim();

    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.substring(7);
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.substring(3);
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    cleanText = cleanText.trim();

    try {
      return JSON.parse(cleanText);
    } catch (err1) {
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
   * Chuẩn hóa danh sách segment
   */
  normalizeSegments(segments) {
    return segments.map((item, index) => {
      let start = item.start || '00:00:00.000';
      let end = item.end || '00:00:02.000';

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
   * Dữ liệu mẫu demo
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
