import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 本地 Embedding 服务（node-llama-cpp + 用户自备 GGUF 嵌入模型）
 * ============================================================================
 * 为 sqlite-vec 向量 ANN 检索提供语义嵌入能力。
 *
 * 设计原则（2026-10-17 修订）：**产品零内置模型**——SciFlow 不自动下载、不预置任何
 * 模型权重。嵌入模型与 LLM 一样属于「用户自备」资产：用户自行放置 GGUF 文件并配置路径，
 * 或干脆不配（功能自动降级，全文检索照常工作）。
 *
 *  - 推荐模型：BAAI bge-small-zh-v1.5 q4_k_m GGUF（~50MB，384 维，与 vec0 表维度匹配；
 *    换其他模型需保证输出 384 维，否则检索将静默降级）
 *  - 配置方式：`EMBEDDING_MODEL_PATH=/path/to/model.gguf`（绝对路径或相对仓库根）
 *    未配置时回退检查默认缓存目录 `~/.sciflow/models/bge-small-zh-v1.5-q4_k_m.gguf`
 *  - 降级链：向量 ANN → FTS5 BM25 → LIKE 全文，embed() 返回 null 即触发下一级
 *  - 懒加载：首次 embed() 调用时加载（~150ms 冷启动），单实例常驻内存
 * ============================================================================
 */

const MODEL_NAME = 'bge-small-zh-v1.5-q4_k_m.gguf';
const CACHE_DIR = path.resolve(process.env.SCIFLOW_MODEL_CACHE || path.join(process.env.HOME || '/tmp', '.sciflow', 'models'));

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private llamaContext: unknown = null;
  private loading: Promise<void> | null = null;

  /** 模块初始化：预热模型（不阻塞启动，首次调用时才加载） */
  async onModuleInit() {
    // 不预热；让用户感知 delay 仅在第 1 次调用；避免启动过慢
    this.logger.log('就绪（模型懒加载；不自动下载任何模型，请配置 EMBEDDING_MODEL_PATH 或放置到默认缓存目录）');
  }

  /** 本地模型路径：用户显式配置优先，其次默认缓存目录（不自动下载） */
  private get modelPath(): string {
    return process.env.EMBEDDING_MODEL_PATH
      ? path.resolve(process.env.EMBEDDING_MODEL_PATH)
      : path.join(CACHE_DIR, MODEL_NAME);
  }

  /** 确认用户自备的模型文件存在（零内置：不存在不下载，直接走降级链） */
  private async ensureModel(): Promise<void> {
    if (fs.existsSync(this.modelPath)) return;
    throw new Error(
      `未找到本地嵌入模型（${this.modelPath}）。SciFlow 不内置任何模型：` +
      `请自行下载 GGUF 嵌入模型（推荐 bge-small-zh-v1.5 q4_k_m，384 维），` +
      `设置 EMBEDDING_MODEL_PATH 指向该文件后重启；不配置则自动使用全文检索（BM25/LIKE），功能不受阻塞。`,
    );
  }

  /** 加载模型（幂等，并发安全） */
  private async loadModel(): Promise<void> {
    if (this.llamaContext) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        await this.ensureModel();
      } catch (e: any) {
        // 用户未配置模型：一次性提示后静默降级（每次 embed 调用返回 null → BM25/LIKE）
        this.logger.warn(e?.message || e);
        this.llamaContext = null;
        return;
      }
      try {
        const { getLlama } = await import('node-llama-cpp');
        const llama = await getLlama();
        const model = await llama.loadModel({ modelPath: this.modelPath });
        const ctx = model.createContext({ contextSize: 512 });
        this.llamaContext = ctx;
        this.logger.log('模型已加载到内存，后续 embed 调用无冷启动开销');
      } catch (e: any) {
        // node-llama-cpp 可能在纯 CPU 容器中失败；降级为 TF 向量回退
        this.logger.warn(`node-llama-cpp 加载失败（将回退到 sqlite-vec 不可用时的 LIKE 兜底）: ${e?.message || e}`);
        this.llamaContext = null;
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
      if (!this.llamaContext) return null; // 模型不可用
      const ctx = this.llamaContext as { getEmbeddingFor?: (text: string) => Promise<{ vector: number[] } | number[]> };
      if (typeof ctx.getEmbeddingFor !== 'function') {
        this.logger.warn('当前 node-llama-cpp 版本不支持快捷 embedding 方法，降级到 TF 回退');
        return null;
      }
      const embedding = await ctx.getEmbeddingFor(text);
      const vector = Array.isArray(embedding) ? embedding : embedding.vector;
      const vec = new Float32Array(vector);
      return Buffer.from(vec.buffer);
    } catch (e: any) {
      this.logger.warn(`embed 失败: ${e?.message || e}`);
      return null;
    }
  }

}
