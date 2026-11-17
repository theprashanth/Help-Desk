import { 
  IUserRepository, ICustomerRepository, IConversationRepository,
  IMessageRepository, ISavedReplyRepository, ITagRepository, ISettingsRepository, IWorkspaceRepository 
} from './interfaces';
import { 
  MongooseUserRepository, MongooseCustomerRepository, MongooseConversationRepository,
  MongooseMessageRepository, MongooseSavedReplyRepository, MongooseTagRepository, MongooseSettingsRepository, MongooseWorkspaceRepository 
} from './mongoose.repo';
import { 
  JsonUserRepository, JsonCustomerRepository, JsonConversationRepository,
  JsonMessageRepository, JsonSavedReplyRepository, JsonTagRepository, JsonSettingsRepository, JsonWorkspaceRepository 
} from './json.repo';

export class RepositoryFactory {
  private static useJson = true; // Default fallback to JSON storage

  static setUseMongoose(use: boolean) {
    this.useJson = !use;
    console.log(`[Database Engine] Active Driver: ${use ? 'MongoDB Mongoose' : 'Local JSON File Storage'}`);
  }

  static isJson(): boolean {
    return this.useJson;
  }

  static getWorkspaceRepository(): IWorkspaceRepository {
    return this.useJson ? new JsonWorkspaceRepository() : new MongooseWorkspaceRepository();
  }

  static getUserRepository(): IUserRepository {
    return this.useJson ? new JsonUserRepository() : new MongooseUserRepository();
  }

  static getCustomerRepository(): ICustomerRepository {
    return this.useJson ? new JsonCustomerRepository() : new MongooseCustomerRepository();
  }

  static getConversationRepository(): IConversationRepository {
    return this.useJson ? new JsonConversationRepository() : new MongooseConversationRepository();
  }

  static getMessageRepository(): IMessageRepository {
     return this.useJson ? new JsonMessageRepository() : new MongooseMessageRepository();
  }

  static getSavedReplyRepository(): ISavedReplyRepository {
    return this.useJson ? new JsonSavedReplyRepository() : new MongooseSavedReplyRepository();
  }

  static getTagRepository(): ITagRepository {
    return this.useJson ? new JsonTagRepository() : new MongooseTagRepository();
  }

  static getSettingsRepository(): ISettingsRepository {
    return this.useJson ? new JsonSettingsRepository() : new MongooseSettingsRepository();
  }
}
