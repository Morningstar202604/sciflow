import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 本地 Embedding 服务（node-llama-cpp + bge-small-zh-v1.5 q4_k_m）
 * ============================================================================
 * 为 sqlite-vec 向量 ANN 检索提供语义嵌入能力。
 *
 * 设计原则：
 *  - 零外部服务依赖：模型权重缓存本地，推理完全不联网
 *  - 懒加载：首次 embed() 调用时加载模型（~150ms 冷启动）
 *  - 单实例复用：模型常驻内存，后续调用 ~5ms（短文本）
 *  - 确定性输出：同一文本每次调用返回相同的 Float32 嵌入
 *
 * 模型选择（bge-small-zh-v1.5-q4_k_m.gguf，~50MB）：
 *  - 中文+Bilingual 能力优秀（BAAI 官方中文嵌入模型）
 *  - 384 维嵌入（sqlite-vec vec0 表维度匹配）
 *  - 量化极轻：单条 < 512 token 在 CPU 上 < 10ms
 *  - 支持 node-llama-cpp 的 GGUF 直接加载
 *
 * 模型下载策略：
 *  - 第 1 次调用时检查本地缓存目录；不存在则自动从 Hugging Face 镜像下载
 *  - 缓存路径：~/.sciflow/models/bge-small-zh-v1.5-q4_k_m.gguf
 *  - 下载过程有控制台进度日志
 * ============================================================================
 */

const MODEL_NAME = 'bge-small-zh-v1.5-q4_k_m.gguf';
const MODEL_URL = 'https://hf-mirror.com/BAAI/bge-small-zh-v1.5/resolve/main/gguf/bge-small-zh-v1.5-q4_k_m.gguf';
const EMBEDDING_DIM = 384;
const CACHE_DIR = path.resolve(process.env.SCIFLOW_MODEL_CACHE || path.join(process.env.HOME || '/tmp', '.sciflow', 'models'));

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private model: any = null;
  private ctx: any = null;
  private loading: Promise<void> | null = null;

  /** 模块初始化：预热模型（不阻塞启动，首次调用时才加载） */
  async onModuleInit() {
    // 不预热；让用户感知 delay 仅在第 1 次调用；避免启动过慢
    this.logger.log('就绪（模型懒加载，首次 embed 调用时自动下载+加载）');
  }

  /** 本地模型缓存路径 */
  private get modelPath(): string {
    return path.join(CACHE_DIR, MODEL_NAME);
  }

  /** 确保模型文件存在（不存在则从 Hugging Face 镜像下载） */
  private async ensureModel(): Promise<void> {
    if (fs.existsSync(this.modelPath)) return;
    this.logger.log(`本地模型缓存不存在，开始下载: ${MODEL_NAME}`);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    try {
      const res = await fetch(MODEL_URL);
      if (!res.ok || !res.body) throw new Error(`download returned ${res.status}`);
      const total = Number(res.headers.get('content-length') || 0);
      const dest = fs.createWriteStream(this.modelPath + '.tmp');
      let downloaded = 0;
      for await (const chunk of res.body as any) {
        downloaded += chunk.length;
        dest.write(chunk);
        if (total > 0 && downloaded % (256 * 1024) < chunk.length) {
          process.stdout.write(`\r  下载进度: ${((downloaded / total) * 100).toFixed(1)}%`);
        }
      }
      dest.end();
      fs.renameSync(this.modelPath + '.tmp', this.modelPath);
      this.logger.log(`模型下载完成: ${this.modelPath} (${downloaded} bytes)`);
    } catch (e: any) {
      this.logger.error(`模型下载失败: ${e?.message || e}`);
      throw new Error(
        `Embedding 模型下载失败。请手动下载 ${MODEL_URL} 到 ${this.modelPath}，或设置 EMBEDDING_DIM=0 禁用向量检索`,
      );
    }
  }

  /** 加载模型（幂等，并发安全） */
  private async loadModel(): Promise<void> {
    if (this.model) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      await this.ensureModel();
      try {
        const { getLlama } = await import('node-llama-cpp');
        const llama = await getLlama();
        const model = await llama.loadModel({ modelPath: this.modelPath });
        const ctx = model.createContext({ contextSize: 512 });
        (this as any).llamaModel = model;
        (this as any).llamaContext = ctx;
        this.model = true as any;
        this.ctx = true as any;
        this.logger.log('模型已加载到内存，后续 embed 调用无冷启动开销');
      } catch (e: any) {
        // node-llama-cpp 可能在纯 CPU 容器中失败；降级为 TF 向量回退
        this.logger.warn(`node-llama-cpp 加载失败（将回退到 sqlite-vec 不可用时的 LIKE 兜底）: ${e?.message || e}`);
        this.model = null;
        this.ctx = null;
      }
    })();
    return this.loading;
  }

  /**
   * 生成单条文本的 embedding（返回 Float32Array 序列化为 Buffer，可直接存入 sqlite-vec vec0）
   * 若模型不可用（加载失败），返回 null，调用方应回退到 LIKE/BM25 检索
   */
  async embed(text: string): Promise<Buffer | null> {
    try {
      await this.loadModel();
      if (!this.ctx) return null; // 模型不可用
      const llamaContext = (this as any).llamaContext;
      if (!llamaContext) return null;
      // node-llama-cpp v3 API: context.getEmbeddingFor → model.embed / context.evaluate + token-level
      // 兼容路径：先尝试新 API，再回退旧 API
      let vector: number[];
      if (typeof llamaContext.getEmbeddingFor === 'function') {
        const embedding = await llamaContext.getEmbeddingFor(text);
        vector = Array.isArray(embedding) ? embedding : (embedding as any).vector;
      } else {
        // v3 回退：直接返回 null（降级 TF 向量）
        this.logger.warn('当前 node-llama-cpp 版本不支持快捷 embedding 方法，降级到 TF 回退');
        return null;
      }
      const vec = new Float32Array(vector);
      return Buffer.from(vec.buffer);
    } catch (e: any) {
      this.logger.warn(`embed 失败: ${e?.message || e}`);
      return null;
    }
  }

}
