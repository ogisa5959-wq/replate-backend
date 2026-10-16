import { Module, forwardRef } from '@nestjs/common';
import { JourneysService } from './journeys.service';
import { JourneysController } from './journeys.controller';
import { RecipientsModule } from '../recipients/recipients.module';

@Module({
  imports: [RecipientsModule],
  controllers: [JourneysController],
  providers: [JourneysService],
  exports: [JourneysService],
})
export class JourneysModule {}
