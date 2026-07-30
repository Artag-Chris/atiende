import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  Logger,
  UseGuards,
  Req,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KnowledgeService } from './knowledge.service';

@UseGuards(JwtAuthGuard)
@Controller('api/knowledge')
export class KnowledgeController {
  private readonly logger = new Logger(KnowledgeController.name);

  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post('text')
  async ingestText(
    @Req() req: Request,
    @Body()
    body: {
      kind: 'FAQ' | 'POLICY' | 'PDF_CATALOG' | 'MANUAL' | 'NOTES' | 'OTHER';
      title: string;
      source: string;
      text: string;
    },
  ) {
    const user = req.user as { businessId: string; role: string } | undefined;
    const docId = await this.knowledgeService.ingestFromText({
      businessId: user?.businessId ?? '',
      ...body,
    });
    return { documentId: docId, status: 'indexed' };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Req() req: Request,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 20 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(pdf|csv|text\/csv)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body()
    body: {
      kind: 'FAQ' | 'POLICY' | 'PDF_CATALOG' | 'MANUAL' | 'NOTES' | 'OTHER';
      title?: string;
    },
  ) {
    const user = req.user as { businessId: string; role: string } | undefined;
    const docId = await this.knowledgeService.ingestFromFile({
      businessId: user?.businessId ?? '',
      kind: body.kind,
      title: body.title ?? file.originalname,
      source: file.originalname,
      content: file.buffer,
      mimeType: file.mimetype,
    });
    return { documentId: docId, status: 'indexed' };
  }

  @Get()
  async list(@Req() req: Request) {
    const user = req.user as { businessId: string; role: string } | undefined;
    return this.knowledgeService.getDocuments(user?.businessId ?? '');
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as { businessId: string; role: string } | undefined;
    const doc = await this.knowledgeService.getDocument(id);
    if (!doc) throw new NotFoundException('Document not found');
    if (user?.role !== 'SUPER_ADMIN' && doc.businessId !== user?.businessId) {
      throw new ForbiddenException('Access denied to this document');
    }
    await this.knowledgeService.deleteDocument(id);
    return { deleted: true };
  }
}
