import "reflect-metadata";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
  console.log("token-refresh-playground api: http://localhost:3000");
}

void bootstrap();
