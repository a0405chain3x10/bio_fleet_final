# Final results (M9)

`npm run bench` — 14 scenarios × 3 variants × 10 seeds = 420 headless runs. Makespan mean ± std (s). Incomplete runs count the timeout as makespan (a lower bound for that variant).

```
scenario             variant          done      makespan(s)   impr% coll maxStuck msg/r/s
S1/4r/none           baseline         10/10        92.3±9.0       —    0     11.2     5.2
S1/4r/none           biofleet         10/10        52.7±1.7    42.9    0      3.3     8.0
S1/4r/none           biofleet-static  10/10        54.0±1.8    41.5    0      3.9     7.3
S2/2r/none           baseline         10/10      203.4±62.9       —    0      6.8     5.1
S2/2r/none           biofleet         10/10        81.5±4.8    60.0    0      7.2     7.7
S2/2r/none           biofleet-static  10/10        79.3±1.3    61.0    0      3.8     6.9
S2/4r/none           baseline         10/10      214.4±26.6       —    0     35.9     5.1
S2/4r/none           biofleet         10/10        97.5±8.5    54.5    0      9.5     8.3
S2/4r/none           biofleet-static  10/10        96.5±5.1    55.0    0      8.1     7.5
S3/6r/none           baseline          1/10     746.7±160.0       —    0    779.6     5.1
S3/6r/none           biofleet         10/10      117.0±12.0    84.3    0     13.0     7.9
S3/6r/none           biofleet-static  10/10      114.4±10.7    84.7    0     11.7     7.2
S4/3r/none           baseline         10/10      900.4±70.4       —    0     12.0     5.2
S4/3r/none           biofleet         10/10       627.3±6.0    30.3    0      9.9     7.6
S4/3r/none           biofleet-static  10/10      625.3±11.8    30.6    0      5.1     6.7
S4/5r/none           baseline         10/10      640.6±49.6       —    0     15.4     5.2
S4/5r/none           biofleet         10/10      412.1±15.5    35.7    0      9.0     7.8
S4/5r/none           biofleet-static  10/10       415.3±8.4    35.2    0      9.9     6.9
S4/10r/none          baseline         10/10      497.1±60.9       —    0     24.9     5.2
S4/10r/none          biofleet         10/10      238.6±11.3    52.0    0      9.0     8.4
S4/10r/none          biofleet-static  10/10      239.2±13.3    51.9    0     10.0     7.5
S4/20r/none          baseline         10/10      376.9±79.3       —    0     66.7     5.3
S4/20r/none          biofleet         10/10       186.1±5.1    50.6    0     15.1     8.5
S4/20r/none          biofleet-static  10/10      185.6±14.0    50.8    0     21.2     7.7
S4:dense/20r/none    baseline          4/10   2056.8±1228.4       —    0   2310.0     5.8
S4:dense/20r/none    biofleet         10/10       153.6±7.7    92.5    0     14.5     9.0
S4:dense/20r/none    biofleet-static  10/10       160.4±7.9    92.2    0     11.1     8.2
S4/10r/F1-10         baseline         10/10      471.1±41.0       —    0     32.1     5.2
S4/10r/F1-10         biofleet         10/10      245.7±11.0    47.8    0     14.1     8.2
S4/10r/F1-10         biofleet-static  10/10      239.9±10.1    49.1    0     12.8     7.4
S4/10r/F1-30         baseline         10/10      460.3±46.4       —    0     19.2     5.3
S4/10r/F1-30         biofleet         10/10       250.4±5.7    45.6    0     13.4     8.0
S4/10r/F1-30         biofleet-static  10/10       241.5±9.8    47.5    0     11.4     7.1
S4/10r/F2            baseline         10/10      446.8±40.6       —    0     24.9     5.3
S4/10r/F2            biofleet         10/10      250.6±14.6    43.9    0     11.2     8.3
S4/10r/F2            biofleet-static  10/10      250.3±13.9    44.0    0     11.5     7.5
S4/10r/F3            baseline         10/10      456.6±41.5       —    0     24.9     5.2
S4/10r/F3            biofleet         10/10       254.4±6.6    44.3    0     11.2     8.3
S4/10r/F3            biofleet-static  10/10       248.2±9.8    45.6    0      9.4     7.5
S4/10r/F4            baseline         10/10      505.1±57.5       —    0     31.9     4.8
S4/10r/F4            biofleet         10/10      266.5±17.4    47.2    0      9.8     7.6
S4/10r/F4            biofleet-static  10/10       262.7±9.3    48.0    0      9.0     6.8
420 runs in 173.8 s → results/final-*.csv
```
