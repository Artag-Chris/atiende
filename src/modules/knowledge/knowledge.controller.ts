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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeService } from './knowledge.service';

@Controller('api/knowledge')
export class KnowledgeController {
  private readonly logger = new Logger(KnowledgeController.name);

  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post('text')
  async ingestText(
    @Body()
    body: {
      businessId: string;
      kind: 'FAQ' | 'POLICY' | 'PDF_CATALOG' | 'MANUAL' | 'NOTES' | 'OTHER';
      title: string;
      source: string;
      text: string;
    },
  ) {
    const docId = await this.knowledgeService.ingestFromText(body);
    return { documentId: docId, status: 'indexed' };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
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
      businessId: string;
      kind: 'FAQ' | 'POLICY' | 'PDF_CATALOG' | 'MANUAL' | 'NOTES' | 'OTHER';
      title?: string;
    },
  ) {
    const docId = await this.knowledgeService.ingestFromFile({
      businessId: body.businessId,
      kind: body.kind,
      title: body.title ?? file.originalname,
      source: file.originalname,
      content: file.buffer,
      mimeType: file.mimetype,
    });
    return { documentId: docId, status: 'indexed' };
  }

  @Get(':businessId')
  async list(@Param('businessId') businessId: string) {
    return this.knowledgeService.getDocuments(businessId);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.knowledgeService.deleteDocument(id);
    return { deleted: true };
  }
}
