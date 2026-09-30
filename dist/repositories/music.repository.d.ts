import { Repository } from '../core/repository';
import { MusicRepositoryGenresResponseRootObject, MusicRepositoryMoodsResponseRootObject } from '../responses';
import { IgAppModule } from '../types/common.types';
import { MusicRepositoryLyricsResponseRootObject } from '../responses/02/music.repository.lyrics.response';
export declare class MusicRepository extends Repository {
    moods(product?: IgAppModule): Promise<MusicRepositoryMoodsResponseRootObject>;
    genres(product?: IgAppModule): Promise<MusicRepositoryGenresResponseRootObject>;
    lyrics(trackId: number | string): Promise<MusicRepositoryLyricsResponseRootObject>;
}
