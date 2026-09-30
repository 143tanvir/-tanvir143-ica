import {
  IgCheckpointError,
  IgLoginRequiredError,
  IgResponseError,
  IgSignupBlockError,
} from '../errors';
import { IgRequest } from '../services/ig-request';
import {
  AccountRepositoryCurrentUserResponseRootObject,
  AccountRepositoryCurrentUserResponseUser,
  AccountRepositoryCurrentUserResponseRootObject as CurrentUserResponse,
} from '../responses';
import { AccountEditProfileOptions } from '../types';

export default class AccountRepository {
  public static accountDebug(message: string) {
    if (process.env.IG_DEBUG === 'true') {
      console.log(`[ACCOUNT] ${message}`);
    }
  }

  private client: IgRequest;

  constructor(client: IgRequest) {
    this.client = client;
  }

  public async currentUser(): Promise<AccountRepositoryCurrentUserResponseUser> {
    /*
     * Session validation must use the plain current-user endpoint.
     *
     * IMPORTANT:
     * Do not add an edit query parameter here.
     *
     * Correct:
     *   /api/v1/accounts/current_user/
     *
     * Incorrect legacy variant:
     *   /api/v1/accounts/current_user/?edit=true
     */

    try {
      const response =
        await this.client.request.send<AccountRepositoryCurrentUserResponse>({
          url: '/api/v1/accounts/current_user/',
        });

      if (!response || !response.body) {
        throw new IgLoginRequiredError(
          'Instagram did not return a current-user response.',
        );
      }

      if (!response.body.user) {
        throw new IgLoginRequiredError(
          'Instagram session did not return a valid user.',
        );
      }

      return response.body.user;
    } catch (error: any) {
      /*
       * Keep Instagram authentication errors explicit.
       * Do not silently convert checkpoint/login-required responses
       * into generic errors.
       */

      const responseBody = error?.response?.body;

      const errorType =
        responseBody?.error_type ||
        responseBody?.errorType ||
        responseBody?.challenge?.challenge_type;

      if (
        errorType === 'checkpoint_challenge_required' ||
        errorType === 'checkpoint_required' ||
        errorType === 'checkpoint'
      ) {
        throw new IgCheckpointError(
          error?.message || 'Instagram checkpoint is required.',
        );
      }

      if (
        errorType === 'login_required' ||
        errorType === 'login_required_for_web' ||
        errorType === 'authentication_required'
      ) {
        throw new IgLoginRequiredError(
          error?.message || 'Instagram login is required.',
        );
      }

      throw error;
    }
  }

  public async editProfile(
    options: AccountEditProfileOptions,
  ): Promise<AccountRepositoryCurrentUserResponseRootObject> {
    const { body } =
      await this.client.request.send<AccountRepositoryCurrentUserResponseRootObject>(
        {
          url: '/api/v1/accounts/edit_profile/',
          method: 'POST',
          form: this.client.request.sign({
            ...options,
            _csrftoken: this.client.state.cookieCsrfToken,
            _uid: this.client.state.cookieUserId,
            device_id: this.client.state.deviceId,
            _uuid: this.client.state.uuid,
          }),
        },
      );

    return body;
  }

  public async setBiography(
    text: string,
  ): Promise<AccountRepositoryCurrentUserResponseRootObject['user']> {
    const { body } =
      await this.client.request.send<AccountRepositoryCurrentUserResponseRootObject>(
        {
          url: '/api/v1/accounts/set_biography/',
          method: 'POST',
          form: this.client.request.sign({
            _csrftoken: this.client.state.cookieCsrfToken,
            _uid: this.client.state.cookieUserId,
            device_id: this.client.state.deviceId,
            _uuid: this.client.state.uuid,
            raw_text: text,
          }),
        },
      );

    return body.user;
  }

  public async changeProfilePicture(
    picture: Buffer,
  ): Promise<AccountRepositoryCurrentUserResponseRootObject> {
    const uploadId = Date.now().toString();

    const { body } =
      await this.client.request.send<AccountRepositoryCurrentUserResponseRootObject>(
        {
          url: '/api/v1/accounts/change_profile_picture/',
          method: 'POST',
          formData: {
            profile_pic: {
              value: picture,
              options: {
                filename: `${uploadId}.jpg`,
                contentType: 'image/jpeg',
              },
            },
          },
        },
      );

    return body;
  }
}
