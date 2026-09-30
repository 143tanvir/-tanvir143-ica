import { AttemptOptions } from '@lifeomic/attempt';
import { Repository } from './repository';
export declare abstract class Feed<Response = any, Item = any> extends Repository {
    attemptOptions: Partial<AttemptOptions<any>>;
    get items$(): any;
    observable(semaphore?: () => Promise<any>, attemptOptions?: Partial<AttemptOptions<any>>): any;
    protected moreAvailable: boolean;
    protected chance: any;
    protected rankToken: any;
    protected abstract set state(response: Response);
    abstract request(...args: any[]): Promise<Response>;
    abstract items(): Promise<Item[]>;
    serialize(): any;
    deserialize(data: string): void;
    toPlain(): any;
    isMoreAvailable(): boolean;
}
