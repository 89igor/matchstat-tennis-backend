import { Injectable } from '@nestjs/common';
import { Connection } from 'typeorm';

@Injectable()
export class PbpStatService {
  constructor(private connection: Connection) {}

  public async getStats(req: any) {
    const type = req.params?.type || 'atp',
      pageNumber = req.query?.pageNumber || 1,
      pageSize = req.query?.pageSize || 20,
      offset = (pageNumber - 1) * pageSize;

    const query = `
    WITH players AS (
      SELECT id FROM player_${type} 
        WHERE ${this.getPlayersFilter(req)} 
      ),
      matches AS (
        SELECT mt.match_id AS match_id
          FROM game_${type} gm, match_info mt
          WHERE 
          ${this.getMatchFiltersQuery(req, type)} AND 
          ( gm."player1Id" = ANY(SELECT id FROM players) OR gm."player2Id" = ANY(SELECT id FROM players) ) AND
          mt.tournament_type = '${type}' AND  
          mt.player_id1 = gm."player1Id" AND 
          mt.player_id2 = gm."player2Id" AND  
          mt.tournament_id = gm."tournamentId" AND 
          mt.round_id = gm."roundId"
        ),
      stats AS (
        SELECT 
            player_id, player_name, 
            COUNT (*) FILTER (WHERE case1 = 1) AS total_case1, 
            COUNT (*) FILTER (WHERE case1 = 1 AND game_service = game_winner::VARCHAR) AS total_case1_won, 
            COUNT (*) FILTER (WHERE case2 = 1) AS total_case2, 
            COUNT (*) FILTER (WHERE case2 = 1 AND game_service = game_winner::VARCHAR) AS total_case2_won, 
            COUNT (*) FILTER(WHERE won_next_game NOTNULL AND game_service != game_winner::VARCHAR ) AS total_case3,
            COUNT (*) FILTER(WHERE won_next_game NOTNULL AND game_service != game_winner::VARCHAR AND won_next_game = 1 ) AS total_case3_won,
            SUM(points_won + points_lost) AS total_case4, 
            SUM(points_won) AS total_case4_won
        FROM pointstats 
        WHERE match_id = ANY (SELECT match_id FROM matches)
          AND player_id = ANY(SELECT id FROM players)
        GROUP BY player_id,player_name
        )	
    SELECT * FROM stats 
    ORDER BY ${this.getSortQuery(req, 'case1', true)}          
    LIMIT ${pageSize} OFFSET ${offset < 0 ? 0 : offset}
    `;

    // console.log(query);

    const data = await this.connection.query(query);
    return { data };
  }

  getPlayersFilter(req) {
    const group = req.query.group || 'singles',
      ranking = req.query.ranking;

    let filters = `name 
      ${group === 'singles' ? 'NOT' : ''} ILIKE '%/%' `;

    if (group === 'singles' && ranking) {
      const [start, end] = [(ranking - 1) * 100 + 1, ranking * 100];
      filters += ` AND "currentRank" BETWEEN ${start} AND ${end} `;
    }

    return filters;
  }

  getMatchFiltersQuery(req, type = 'atp') {
    const { year = 2020, courtid, rank } = req.query;

    let filterQuery = 'gm.date NOTNULL';

    if (year) {
      filterQuery += ` AND DATE_TRUNC('year', gm.date) = '${year}-01-01'::TIMESTAMP`;
    }

    if (courtid || rank) {
      let conditions = [];

      if (courtid) {
        conditions.push(`"courtId" = ${courtid}`);
      }
      if (rank) {
        conditions.push(`"rankId" = ${rank}`);
      }

      filterQuery += ` AND 
        gm."tournamentId" = ANY( 
          SELECT id FROM tournament_${type} WHERE ${conditions.join(' AND ')} 
        )
      `;
    }

    return filterQuery;
  }

  getSortQuery(req, statCase, compareSortBy = false) {
    const sortBy = req.query.sortBy || 'case1',
      sortOrder = req.query.sortOrder || 'DESC';

    console.log({ sortBy });

    const sortQueries = {
      case1: `TRUNC(total_case1_won::DECIMAL/GREATEST(total_case1,1),2) ${sortOrder}, total_case1 ${sortOrder}`,
      case2: `TRUNC(total_case2_won::DECIMAL/GREATEST(total_case2,1),2) ${sortOrder}, total_case2 ${sortOrder}`,
      case3: `TRUNC(total_case3_won::DECIMAL/GREATEST(total_case3,1),2) ${sortOrder}, total_case3 ${sortOrder}`,
      case4: `TRUNC(total_case4_won::DECIMAL/GREATEST(total_case4,1),2) ${sortOrder}, total_case4 ${sortOrder}`,
    };

    return sortQueries[compareSortBy ? sortBy : statCase];
  }
}
